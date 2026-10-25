//! The rendered view of a note's Markdown: the blocks of `markdown` as styled terminal lines,
//! wrapped to the width on the way so a quote's bar and a list's indent stay on every line.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

use crate::markdown::{Block, Span as Run};

const MUTED: Style = Style::new().fg(Color::DarkGray);

/// The note as lines at most `width` columns wide.
pub fn lines(blocks: &[Block], width: usize) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    for (n, block) in blocks.iter().enumerate() {
        if n > 0 {
            out.push(Line::raw(""));
        }
        out.extend(block_lines(block, width.max(1)));
    }
    out
}

fn run_style(run: &Run, heading: Option<u8>) -> Style {
    let mut style = Style::new();
    if run.bold || heading.is_some() {
        style = style.add_modifier(Modifier::BOLD);
    }
    if run.italic {
        style = style.add_modifier(Modifier::ITALIC);
    }
    if run.strike {
        style = style.add_modifier(Modifier::CROSSED_OUT);
    }
    if run.code {
        style = style.fg(Color::Yellow);
    }
    if run.link {
        style = style.fg(Color::Cyan).add_modifier(Modifier::UNDERLINED);
    }
    if let Some(level) = heading {
        style = style.fg(Color::Cyan);
        if level == 1 {
            style = style.add_modifier(Modifier::UNDERLINED);
        }
    }
    style
}

fn width_of(text: &str) -> usize {
    Span::raw(text).width()
}

/// Greedy word wrap of styled runs; a word longer than a line is cut.
fn wrap(runs: &[Run], heading: Option<u8>, width: usize) -> Vec<Line<'static>> {
    let mut lines: Vec<Vec<Span<'static>>> = vec![Vec::new()];
    let mut column = 0;
    for run in runs {
        let style = run_style(run, heading);
        for (i, part) in run.text.split('\n').enumerate() {
            if i > 0 {
                lines.push(Vec::new());
                column = 0;
            }
            for word in part.split_inclusive(' ') {
                let w = width_of(word.trim_end());
                if column > 0 && column + w > width {
                    lines.push(Vec::new());
                    column = 0;
                }
                let mut rest = word;
                while width_of(rest.trim_end()) > width {
                    let mut cut = 0;
                    let mut used = 0;
                    for c in rest.chars() {
                        let cw = width_of(c.encode_utf8(&mut [0; 4]));
                        if used + cw > width {
                            break;
                        }
                        used += cw;
                        cut += c.len_utf8();
                    }
                    if cut == 0 {
                        break;
                    }
                    lines.last_mut().unwrap().push(Span::styled(rest[..cut].to_owned(), style));
                    lines.push(Vec::new());
                    column = 0;
                    rest = &rest[cut..];
                }
                lines.last_mut().unwrap().push(Span::styled(rest.to_owned(), style));
                column += width_of(rest);
            }
        }
    }
    lines.into_iter().map(Line::from).collect()
}

/// Puts `first` before the first line and `rest` before the others.
fn prefixed(lines: Vec<Line<'static>>, first: Span<'static>, rest: Span<'static>) -> Vec<Line<'static>> {
    lines
        .into_iter()
        .enumerate()
        .map(|(i, line)| {
            let mut spans = vec![if i == 0 { first.clone() } else { rest.clone() }];
            spans.extend(line.spans);
            Line::from(spans)
        })
        .collect()
}

fn block_lines(block: &Block, width: usize) -> Vec<Line<'static>> {
    match block {
        Block::Para(runs) => wrap(runs, None, width),
        Block::Heading(level, runs) => wrap(runs, Some(*level), width),
        Block::Code(code) => code.lines().map(|line| Line::styled(format!("  {line}"), Style::new().fg(Color::Yellow))).collect(),
        Block::Quote(inner) => prefixed(lines(inner, width.saturating_sub(2)), Span::styled("│ ", MUTED), Span::styled("│ ", MUTED)),
        Block::Rule => vec![Line::styled("─".repeat(width), MUTED)],
        Block::List { start, items } => {
            let mut out = Vec::new();
            for (i, item) in items.iter().enumerate() {
                let marker = match (start, item.task) {
                    (_, Some(true)) => "[x] ".to_owned(),
                    (_, Some(false)) => "[ ] ".to_owned(),
                    (Some(first), None) => format!("{}. ", first + i as u64),
                    (None, None) => "• ".to_owned(),
                };
                let pad = width_of(&marker);
                let inner = lines(&item.blocks, width.saturating_sub(pad));
                out.extend(prefixed(inner, Span::styled(marker, MUTED), Span::raw(" ".repeat(pad))));
            }
            out
        }
        Block::Table { head, rows } => {
            let cells: Vec<Vec<String>> = rows
                .iter()
                .map(|row| row.iter().map(|cell| cell.iter().map(|run| run.text.as_str()).collect::<String>()).collect())
                .collect();
            let columns = cells.iter().map(Vec::len).max().unwrap_or(0);
            let widths: Vec<usize> =
                (0..columns).map(|c| cells.iter().filter_map(|row| row.get(c)).map(|cell| width_of(cell)).max().unwrap_or(0)).collect();
            let mut out = Vec::new();
            for (r, row) in cells.iter().enumerate() {
                let mut spans = Vec::new();
                for (c, w) in widths.iter().enumerate() {
                    if c > 0 {
                        spans.push(Span::styled(" │ ", MUTED));
                    }
                    let cell = row.get(c).map_or("", String::as_str);
                    let style = if r < *head { Style::new().add_modifier(Modifier::BOLD) } else { Style::new() };
                    spans.push(Span::styled(format!("{cell}{}", " ".repeat(w - width_of(cell))), style));
                }
                out.push(Line::from(spans));
                if r + 1 == *head {
                    let rule = widths.iter().map(|w| "─".repeat(*w)).collect::<Vec<_>>().join("─┼─");
                    out.push(Line::styled(rule, MUTED));
                }
            }
            out
        }
    }
}
