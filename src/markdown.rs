//! Markdown in notes: one parse, three uses. The window draws the blocks, "Copy as plain text"
//! strips them to text, and "Copy as HTML" writes them as HTML.
//!
//! A note is text first, so the parse is forgiving and lossless in the one place it matters:
//! line breaks stay line breaks (as in a chat or a GitHub comment), not spaces. What the output
//! never carries is anything a pasted note could act on: raw HTML is shown as text, an image as
//! its alt text (pasting must not fetch anything), and a link only if it is http(s) or mailto.

use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

/// A run of text with the same look.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Span {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub strike: bool,
    pub code: bool,
    pub link: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    /// `Some(done)` for a task list item.
    pub task: Option<bool>,
    pub blocks: Vec<Block>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Block {
    Para(Vec<Span>),
    Heading(u8, Vec<Span>),
    Code(String),
    Quote(Vec<Block>),
    /// `start` is the number of the first item of a numbered list.
    List {
        start: Option<u64>,
        items: Vec<Item>,
    },
    Rule,
    /// The first `head` rows are the header.
    Table {
        head: usize,
        rows: Vec<Vec<Vec<Span>>>,
    },
}

fn options() -> Options {
    Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS
}

fn safe_link(url: &str) -> bool {
    let url = url.trim_start().to_ascii_lowercase();
    ["http://", "https://", "mailto:"].iter().any(|scheme| url.starts_with(scheme))
}

/// The parser's events, made safe to hand on: see the module comment.
fn events(src: &str) -> impl Iterator<Item = Event<'_>> {
    // Whether each open link was kept, so its end is kept or dropped with its start.
    let mut links: Vec<bool> = Vec::new();
    Parser::new_ext(src, options()).filter_map(move |event| match event {
        Event::Html(text) | Event::InlineHtml(text) => Some(Event::Text(text)),
        Event::SoftBreak => Some(Event::HardBreak),
        Event::Start(Tag::Image { .. }) | Event::End(TagEnd::Image) => None,
        Event::Start(Tag::Link { ref dest_url, .. }) => {
            links.push(safe_link(dest_url));
            links.last().copied().unwrap_or(false).then_some(event)
        }
        Event::End(TagEnd::Link) => links.pop().unwrap_or(false).then_some(event),
        event => Some(event),
    })
}

/// The note as HTML, for pasting into a mail or a document. A fragment, not a page.
pub fn html(src: &str) -> String {
    let mut out = String::new();
    pulldown_cmark::html::push_html(&mut out, events(src));
    out
}

/// The note without its Markdown: the text, with list markers and tabbed table cells kept so
/// it still reads as what it was.
pub fn strip(src: &str) -> String {
    plain(&blocks(src), "\n\n")
}

pub fn blocks(src: &str) -> Vec<Block> {
    blocks_until(&mut events(src).peekable())
}

type Events<'a, I> = std::iter::Peekable<I>;

/// Reads blocks up to and including the end of the container they are in (or to the end).
fn blocks_until<'a, I: Iterator<Item = Event<'a>>>(it: &mut Events<'a, I>) -> Vec<Block> {
    let mut out = Vec::new();
    while let Some(event) = it.peek() {
        match event {
            Event::End(_) => {
                it.next();
                break;
            }
            // Text straight in a container: a tight list item has no paragraph around it.
            Event::Text(_)
            | Event::Code(_)
            | Event::HardBreak
            | Event::Start(Tag::Emphasis | Tag::Strong | Tag::Strikethrough | Tag::Link { .. }) => {
                out.push(Block::Para(inlines(it)));
            }
            Event::Rule => {
                it.next();
                out.push(Block::Rule);
            }
            Event::Start(_) => {
                let Some(Event::Start(tag)) = it.next() else { break };
                match tag {
                    Tag::Paragraph | Tag::HtmlBlock => {
                        out.push(Block::Para(inlines(it)));
                        it.next();
                    }
                    Tag::Heading { level, .. } => {
                        out.push(Block::Heading(level_number(level), inlines(it)));
                        it.next();
                    }
                    Tag::BlockQuote(_) => out.push(Block::Quote(blocks_until(it))),
                    Tag::CodeBlock(kind) => out.push(code_block(it, kind)),
                    Tag::List(start) => out.push(Block::List { start, items: items(it) }),
                    Tag::Table(_) => out.push(table(it)),
                    // Nothing else is switched on; a container we don't know keeps its content.
                    _ => out.extend(blocks_until(it)),
                }
            }
            _ => {
                it.next();
            }
        }
    }
    out
}

fn level_number(level: HeadingLevel) -> u8 {
    level as u8
}

fn code_block<'a, I: Iterator<Item = Event<'a>>>(it: &mut Events<'a, I>, _kind: CodeBlockKind<'a>) -> Block {
    let mut text = String::new();
    for event in it.by_ref() {
        match event {
            Event::Text(t) => text.push_str(&t),
            Event::End(_) => break,
            _ => {}
        }
    }
    Block::Code(text.trim_end_matches('\n').to_owned())
}

fn items<'a, I: Iterator<Item = Event<'a>>>(it: &mut Events<'a, I>) -> Vec<Item> {
    let mut items = Vec::new();
    while let Some(event) = it.next() {
        match event {
            Event::Start(Tag::Item) => {
                let task = match it.peek() {
                    Some(&Event::TaskListMarker(done)) => {
                        it.next();
                        Some(done)
                    }
                    _ => None,
                };
                items.push(Item { task, blocks: blocks_until(it) });
            }
            Event::End(_) => break,
            _ => {}
        }
    }
    items
}

fn table<'a, I: Iterator<Item = Event<'a>>>(it: &mut Events<'a, I>) -> Block {
    let (mut rows, mut row, mut head) = (Vec::new(), Vec::new(), 0);
    while let Some(event) = it.next() {
        match event {
            Event::Start(Tag::TableCell) => {
                row.push(inlines(it));
                it.next();
            }
            Event::End(TagEnd::TableHead) => {
                rows.push(std::mem::take(&mut row));
                head = rows.len();
            }
            Event::End(TagEnd::TableRow) => rows.push(std::mem::take(&mut row)),
            Event::End(TagEnd::Table) => break,
            _ => {}
        }
    }
    Block::Table { head, rows }
}

/// Reads inline content up to (not including) the first event that is not inline.
fn inlines<'a, I: Iterator<Item = Event<'a>>>(it: &mut Events<'a, I>) -> Vec<Span> {
    let mut spans: Vec<Span> = Vec::new();
    let (mut bold, mut italic, mut strike, mut link) = (0u32, 0u32, 0u32, 0u32);
    let mut push = |text: &str, code: bool, (bold, italic, strike, link): (u32, u32, u32, u32)| {
        let span = Span { text: text.to_owned(), bold: bold > 0, italic: italic > 0, strike: strike > 0, code, link: link > 0 };
        match spans.last_mut() {
            Some(last)
                if (last.bold, last.italic, last.strike, last.code, last.link)
                    == (span.bold, span.italic, span.strike, span.code, span.link) =>
            {
                last.text.push_str(text)
            }
            _ => spans.push(span),
        }
    };
    while let Some(event) = it.peek() {
        match event {
            Event::Text(_) | Event::Code(_) | Event::HardBreak => {}
            Event::Start(Tag::Emphasis | Tag::Strong | Tag::Strikethrough | Tag::Link { .. }) => {}
            Event::End(TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Link) => {}
            _ => break,
        }
        match it.next() {
            Some(Event::Text(t)) => push(&t, false, (bold, italic, strike, link)),
            Some(Event::Code(t)) => push(&t, true, (bold, italic, strike, link)),
            Some(Event::HardBreak) => push("\n", false, (bold, italic, strike, link)),
            Some(Event::Start(Tag::Emphasis)) => italic += 1,
            Some(Event::Start(Tag::Strong)) => bold += 1,
            Some(Event::Start(Tag::Strikethrough)) => strike += 1,
            Some(Event::Start(Tag::Link { .. })) => link += 1,
            Some(Event::End(TagEnd::Emphasis)) => italic = italic.saturating_sub(1),
            Some(Event::End(TagEnd::Strong)) => bold = bold.saturating_sub(1),
            Some(Event::End(TagEnd::Strikethrough)) => strike = strike.saturating_sub(1),
            Some(Event::End(TagEnd::Link)) => link = link.saturating_sub(1),
            _ => {}
        }
    }
    spans
}

fn text_of(spans: &[Span]) -> String {
    spans.iter().map(|s| s.text.as_str()).collect()
}

fn plain(blocks: &[Block], separator: &str) -> String {
    let parts: Vec<String> = blocks
        .iter()
        .map(|block| match block {
            Block::Para(spans) | Block::Heading(_, spans) => text_of(spans),
            Block::Code(text) => text.clone(),
            Block::Quote(inner) => plain(inner, "\n\n"),
            Block::Rule => String::new(),
            Block::List { start, items } => {
                let lines: Vec<String> = items
                    .iter()
                    .enumerate()
                    .map(|(n, item)| {
                        let marker = match (start, item.task) {
                            (_, Some(done)) => if done { "[x] " } else { "[ ] " }.to_owned(),
                            (Some(first), None) => format!("{}. ", first + n as u64),
                            (None, None) => "- ".to_owned(),
                        };
                        // What follows the first line lines up under the text, not the marker.
                        let pad = " ".repeat(marker.chars().count());
                        let body = plain(&item.blocks, "\n");
                        let mut lines = body.lines();
                        let first = lines.next().unwrap_or_default();
                        let rest: String = lines.map(|l| if l.is_empty() { "\n".to_owned() } else { format!("\n{pad}{l}") }).collect();
                        format!("{marker}{first}{rest}")
                    })
                    .collect();
                lines.join("\n")
            }
            Block::Table { rows, .. } => {
                rows.iter().map(|row| row.iter().map(|cell| text_of(cell)).collect::<Vec<_>>().join("\t")).collect::<Vec<_>>().join("\n")
            }
        })
        .filter(|part| !part.is_empty())
        .collect();
    parts.join(separator)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_inline_markup_and_keeps_lines() {
        assert_eq!(strip("**bold** and *it* and ~~gone~~ and `code`\nnext line"), "bold and it and gone and code\nnext line");
        assert_eq!(strip("# Title\n\nbody"), "Title\n\nbody");
        assert_eq!(strip("[the docs](https://example.com) here"), "the docs here");
        assert_eq!(strip("![a cat](http://x/cat.png)"), "a cat");
    }

    #[test]
    fn strips_lists_quotes_code_and_tables() {
        assert_eq!(strip("- one\n- two\n  - nested\n\n1. a\n2. b"), "- one\n- two\n  - nested\n\n1. a\n2. b");
        assert_eq!(strip("- [x] done\n- [ ] todo"), "[x] done\n[ ] todo");
        assert_eq!(strip("> quoted\n> text"), "quoted\ntext");
        assert_eq!(strip("```rust\nlet x = 1;\n```\nafter"), "let x = 1;\n\nafter");
        assert_eq!(strip("| a | b |\n|---|---|\n| 1 | 2 |"), "a\tb\n1\t2");
        assert_eq!(strip("one\n\n---\n\ntwo"), "one\n\ntwo");
    }

    #[test]
    fn plain_text_stays_plain_text() {
        let text = "just a note\nwith two lines\n\nand a gap";
        assert_eq!(strip(text), text);
        assert_eq!(strip(""), "");
    }

    #[test]
    fn html_has_the_usual_tags_and_hard_line_breaks() {
        let out = html("# Hi\n\n**b** and `c`\nnext\n\n- a\n- b");
        assert!(out.contains("<h1>Hi</h1>"), "{out}");
        assert!(out.contains("<strong>b</strong> and <code>c</code><br />"), "{out}");
        assert!(out.contains("<ul>") && out.contains("<li>a</li>"), "{out}");
    }

    #[test]
    fn html_never_carries_what_a_paste_could_act_on() {
        let out = html(
            "<script>alert(1)</script>\n\ntext <img src=x onerror=y>\n\n![alt](https://evil/x.png)\n\n[click](javascript:alert(1)) [ok](https://a.example) [m](mailto:a@b.c)",
        );
        assert!(!out.contains("<script") && !out.contains("<img"), "{out}");
        assert!(out.contains("&lt;script&gt;"), "{out}");
        assert!(!out.contains("javascript:") && !out.contains("evil"), "{out}");
        assert!(out.contains("click") && out.contains("alt"), "{out}");
        assert!(out.contains(r#"<a href="https://a.example">ok</a>"#) && out.contains(r#"href="mailto:a@b.c""#), "{out}");
        // The same text is plain in the stripped form.
        assert!(strip("<b>x</b>").contains("<b>x</b>"));
    }

    #[test]
    fn blocks_keep_the_look_of_each_run() {
        let blocks = blocks("a **b *c*** `d` [e](https://x.y)");
        let [Block::Para(spans)] = blocks.as_slice() else { panic!("{blocks:?}") };
        let looks: Vec<_> = spans.iter().map(|s| (s.text.as_str(), s.bold, s.italic, s.code, s.link)).collect();
        assert_eq!(
            looks,
            [
                ("a ", false, false, false, false),
                ("b ", true, false, false, false),
                ("c", true, true, false, false),
                (" ", false, false, false, false),
                ("d", false, false, true, false),
                (" ", false, false, false, false),
                ("e", false, false, false, true)
            ]
        );
    }

    #[test]
    fn a_tight_list_item_is_a_paragraph_and_numbers_continue() {
        let blocks = blocks("3. x\n4. y");
        let [Block::List { start: Some(3), items }] = blocks.as_slice() else { panic!("{blocks:?}") };
        assert_eq!(items.len(), 2);
        assert!(matches!(items[0].blocks.as_slice(), [Block::Para(_)]));
        assert_eq!(strip("3. x\n4. y"), "3. x\n4. y");
    }
}
