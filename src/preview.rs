//! The rendered view of a note: the blocks of `markdown` drawn with the window's own fonts and
//! colours. Text can be selected and copied; links are shown as links but never opened from here.

use egui::text::{LayoutJob, TextFormat};
use egui::{Color32, FontId, Stroke};

use crate::markdown::{Block, Span};
use crate::theme::{self, Tokens};

struct Look<'a> {
    t: &'a Tokens,
    /// The note's font size, and whether its font is the monospace one.
    size: f32,
    mono: bool,
    /// Counts what needs an id of its own (lists nested in lists, tables).
    ids: usize,
    /// Inside a list item, where blocks sit close together.
    tight: bool,
}

pub fn show(ui: &mut egui::Ui, blocks: &[Block], t: &Tokens, size: f32, mono: bool) {
    let mut look = Look { t, size, mono, ids: 0, tight: false };
    look.blocks(ui, blocks);
}

impl Look<'_> {
    fn base(&self) -> FontId {
        if self.mono { FontId::monospace(self.size - 1.0) } else { theme::regular(self.size) }
    }

    fn job(&self, spans: &[Span], scale: f32, heading: bool, wrap: f32) -> LayoutJob {
        let mut job = LayoutJob::default();
        job.wrap.max_width = wrap;
        for span in spans {
            let font = if span.code {
                FontId::monospace((self.size - 1.0) * scale)
            } else if span.bold || heading {
                theme::semibold(self.size * scale)
            } else {
                let base = self.base();
                FontId::new(base.size * scale, base.family)
            };
            let format = TextFormat {
                font_id: font,
                color: if span.link { self.t.accent } else { self.t.text },
                background: if span.code { self.t.divider } else { Color32::TRANSPARENT },
                italics: span.italic,
                underline: if span.link { Stroke::new(1.0, self.t.accent) } else { Stroke::NONE },
                strikethrough: if span.strike { Stroke::new(1.0, self.t.text) } else { Stroke::NONE },
                ..Default::default()
            };
            job.append(&span.text, 0.0, format);
        }
        job
    }

    fn text(&self, ui: &mut egui::Ui, spans: &[Span], scale: f32, heading: bool) {
        let job = self.job(spans, scale, heading, ui.available_width());
        ui.add(egui::Label::new(job).wrap());
    }

    fn blocks(&mut self, ui: &mut egui::Ui, blocks: &[Block]) {
        let gap = if self.tight { 2.0 } else { self.size * 0.5 };
        for (n, block) in blocks.iter().enumerate() {
            if n > 0 {
                ui.add_space(gap);
            }
            match block {
                Block::Para(spans) => self.text(ui, spans, 1.0, false),
                Block::Heading(level, spans) => {
                    let scale = [1.0, 1.6, 1.35, 1.2, 1.1, 1.0, 1.0][usize::from(*level).min(6)];
                    self.text(ui, spans, scale, true);
                }
                Block::Code(code) => {
                    egui::Frame::new().fill(self.t.divider).corner_radius(6).inner_margin(8).show(ui, |ui| {
                        ui.set_min_width(ui.available_width());
                        let font = FontId::monospace(self.size - 1.0);
                        ui.add(egui::Label::new(egui::RichText::new(code).font(font).color(self.t.text)).wrap());
                    });
                }
                Block::Quote(inner) => {
                    self.ids += 1;
                    ui.indent(("quote", self.ids), |ui| self.blocks(ui, inner));
                }
                Block::Rule => {
                    ui.add(egui::Separator::default().spacing(gap));
                }
                Block::List { start, items } => {
                    for (i, item) in items.iter().enumerate() {
                        let marker = match (start, item.task) {
                            (_, Some(true)) => "[x]".to_owned(),
                            (_, Some(false)) => "[ ]".to_owned(),
                            (Some(first), None) => format!("{}.", first + i as u64),
                            (None, None) => "•".to_owned(),
                        };
                        ui.horizontal_top(|ui| {
                            ui.spacing_mut().item_spacing.x = 6.0;
                            let font = if item.task.is_some() { FontId::monospace(self.size - 1.0) } else { self.base() };
                            ui.add(egui::Label::new(egui::RichText::new(marker).font(font).color(self.t.text_muted)));
                            ui.vertical(|ui| {
                                let outer = std::mem::replace(&mut self.tight, true);
                                self.blocks(ui, &item.blocks);
                                self.tight = outer;
                            });
                        });
                    }
                }
                Block::Table { head, rows } => {
                    self.ids += 1;
                    egui::Grid::new(("table", self.ids)).spacing([14.0, 4.0]).show(ui, |ui| {
                        for (r, row) in rows.iter().enumerate() {
                            for cell in row {
                                let job = self.job(cell, 1.0, r < *head, f32::INFINITY);
                                ui.add(egui::Label::new(job));
                            }
                            ui.end_row();
                        }
                    });
                }
            }
        }
    }
}
