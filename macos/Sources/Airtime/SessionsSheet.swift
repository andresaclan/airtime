import AirtimeKit
import Charts
import SwiftUI

struct SessionsSheet: View {
	@Environment(AppModel.self) private var app
	@Environment(\.dismiss) private var dismiss
	@State private var confirmDelete: Session?

	var body: some View {
		@Bindable var app = app
		VStack(alignment: .leading, spacing: 0) {
			HStack(alignment: .top) {
				VStack(alignment: .leading, spacing: 4) {
					Text("Saved sessions").font(.system(size: 16, weight: .semibold))
					Text(app.sessionsTab == .list ? "Open a session to pick up where you left off; Airtime finds its video." : "Compare recorded sessions. Select a date to inspect its jumps.")
						.font(.system(size: 13)).foregroundStyle(Theme.fgSecondary)
				}
				Spacer()
				Button {
					dismiss()
				} label: {
					Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).frame(width: 24, height: 24)
				}
				.buttonStyle(.plain).keyboardShortcut(.cancelAction)
			}
			.padding(.horizontal, 24).padding(.top, 22)
			Picker("", selection: $app.sessionsTab) {
				Text("List").tag(AppModel.SessionsTab.list)
				Text("Trends").tag(AppModel.SessionsTab.trends)
			}
			.pickerStyle(.segmented).labelsHidden().fixedSize()
			.padding(.horizontal, 24).padding(.vertical, 14)
			Divider().overlay(Theme.border)
			Group {
				if app.sessionsTab == .list { list } else { TrendsView(close: { dismiss() }) }
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			Divider().overlay(Theme.border)
			HStack {
				Label("Saved on this Mac · \(app.sessions.count) session\(app.sessions.count == 1 ? "" : "s")", systemImage: "checkmark.shield")
					.font(.system(size: 12)).foregroundStyle(Theme.fgMuted)
					.help(app.store.root.path)
				Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([app.store.root]) }
					.buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(Theme.fgSecondary)
				Spacer()
				Button("Import backup…") { app.importBackup() }.buttonStyle(QuietButtonStyle())
				Button("Export all…") { app.export(app.sessions) }.buttonStyle(QuietButtonStyle(prominent: true)).disabled(app.sessions.isEmpty)
			}
			.padding(.horizontal, 24).padding(.vertical, 12)
		}
		.frame(width: 640, height: 680)
		.background(Theme.elevated)
		.alert("Delete \(confirmDelete?.title ?? "")?", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } })) {
			Button("Delete", role: .destructive) { if let s = confirmDelete { app.delete(s) } }
			Button("Cancel", role: .cancel) {}
		} message: {
			Text("Its marks and notes are removed from this Mac. The video itself isn't touched.")
		}
	}

	private var list: some View {
		ScrollView {
			VStack(spacing: 0) {
				if app.sessions.isEmpty {
					VStack(spacing: 8) {
						Text("No saved sessions yet").font(.system(size: 14, weight: .medium))
						Text("Mark a video and press ⌘S, or import a backup from the web app.").font(.system(size: 13)).foregroundStyle(Theme.fgMuted)
					}
					.padding(.top, 60)
				}
				ForEach(app.sessions) { session in
					let summary = sessionSummary(session)
					HStack(spacing: 10) {
						VStack(alignment: .leading, spacing: 3) {
							Text(session.title).font(.system(size: 14, weight: .medium)).lineLimit(1)
							Text("Recorded \(isoDate(session.recordedAt)?.mediumDate ?? "–") · saved \(isoDate(session.updatedAt)?.dateTime ?? "") · \(summary.jumps) jump\(summary.jumps == 1 ? "" : "s") · \(session.media.fileName)")
								.font(.system(size: 12)).foregroundStyle(Theme.fgMuted).lineLimit(1).truncationMode(.middle)
						}
						Spacer()
						if let best = summary.bestFlightMs { Measure(value: String(Int(best.rounded())), size: 13, weight: .medium) }
						Button("Open") {
							dismiss()
							app.openSession(session)
						}
						.buttonStyle(QuietButtonStyle(prominent: true))
						Button("Results") {
							dismiss()
							app.showResults(session)
						}
						.buttonStyle(QuietButtonStyle())
						Menu {
							Button("Export…") { app.export([session]) }
							Button("Locate video…") {
								dismiss()
								Task { await app.locate(session) }
							}
							Divider()
							Button("Delete…", role: .destructive) { confirmDelete = session }
						} label: {
							Image(systemName: "ellipsis")
						}
						.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
					}
					.padding(.horizontal, 24).padding(.vertical, 12)
					Divider().overlay(Theme.border).padding(.horizontal, 16)
				}
				if app.unreadable > 0 {
					Text("\(app.unreadable) saved file\(app.unreadable == 1 ? " was" : "s were") written by a newer Airtime and can't be read here; they're left untouched.")
						.font(.system(size: 12)).foregroundStyle(Theme.warning).padding(24)
				}
			}
		}
	}
}

/// Flight and contact time across sessions of one jump type.
struct TrendsView: View {
	@Environment(AppModel.self) private var app
	var close: () -> Void
	@State private var groupId: String?
	@State private var everyJump = false
	@State private var range = trendRanges[3]
	@State private var selected: String?

	var body: some View {
		let groups = trendGroups(app.sessions)
		if groups.isEmpty {
			VStack(spacing: 8) {
				Text("No trends yet").font(.system(size: 14, weight: .medium))
				Text("Save sessions with completed jumps to compare them over time.").font(.system(size: 13)).foregroundStyle(Theme.fgMuted)
			}
			.padding(.top, 60)
		} else {
			let group = groups.first { $0.id == groupId } ?? latestGroup(groups)!
			let points = withinMonths(group.points, range.months)
			let selectedPoint = points.first { $0.id == selected } ?? points.last
			ScrollView {
				VStack(alignment: .leading, spacing: 18) {
					if groups.count > 1 {
						Picker("Jump type", selection: Binding(get: { group.id }, set: { groupId = $0; selected = nil })) {
							ForEach(groups) { Text("\($0.label) \($0.points.count)").tag($0.id) }
						}
						.pickerStyle(.segmented).labelsHidden().fixedSize()
					} else {
						(Text(group.label).fontWeight(.semibold) + Text(" \(group.points.count)").foregroundColor(Theme.fgMuted)).font(.system(size: 13))
					}
					HStack {
						Picker("", selection: $everyJump) {
							Text("Best jump").tag(false)
							Text("Every jump").tag(true)
						}
						.pickerStyle(.segmented).labelsHidden().fixedSize()
						Spacer()
						Picker("", selection: $range) {
							ForEach(trendRanges) { Text($0.label).tag($0) }
						}
						.pickerStyle(.segmented).labelsHidden().fixedSize()
					}
					if points.isEmpty {
						Text("No sessions in this range.").font(.system(size: 13)).foregroundStyle(Theme.fgMuted)
					} else {
						chart(title: "Flight time", points: points, selected: selectedPoint, value: { $0.flightMs })
						if group.showContact {
							chart(title: "Contact time", points: points, selected: selectedPoint, value: { $0.contactMs })
						}
						if let point = selectedPoint { detail(point) }
					}
				}
				.padding(24)
			}
		}
	}

	private func chart(title: String, points: [TrendPoint], selected: TrendPoint?, value: @escaping (TrendJump) -> Double?) -> some View {
		let charted = points.filter { value($0.best) != nil }
		let latest = charted.last
		let first = charted.first
		// Round ends a few ticks wide, so a near-flat series isn't blown up into a cliff.
		let values = charted.flatMap { p in (everyJump ? p.jumps : [p.best]).compactMap(value) }
		let low = values.min() ?? 0, high = values.max() ?? 0
		let pad = max(10, (high - low) * 0.15)
		let domain = ((low - pad) / 10).rounded(.down) * 10...((high + pad) / 10).rounded(.up) * 10
		return VStack(alignment: .leading, spacing: 8) {
			HStack(alignment: .firstTextBaseline) {
				Text(title).font(.system(size: 13)).foregroundStyle(Theme.fgSecondary)
				Spacer()
				if let latest, let v = value(latest.best) {
					Text("Latest").font(.system(size: 12)).foregroundStyle(Theme.fgMuted)
					Measure(value: String(Int(v.rounded())), size: 17, weight: .semibold)
					if let first, first.id != latest.id, let f = value(first.best) {
						let change = Int((v - f).rounded())
						Text("\(change >= 0 ? "+" : "−")\(abs(change)) since \(first.date.formatted(.dateTime.month(.abbreviated).day()))")
							.font(.system(size: 12)).foregroundStyle(Theme.fgMuted)
					}
				}
			}
			if charted.count == 1, let only = charted.first {
				Text("One session so far, recorded \(only.date.mediumDate). Save another of this jump type to see a trend.")
					.font(.system(size: 12)).foregroundStyle(Theme.fgMuted)
			} else {
			Chart {
				ForEach(charted) { point in
					if let v = value(point.best) {
						LineMark(x: .value("Recorded", point.date), y: .value(title, v))
							.foregroundStyle(Theme.fg.opacity(0.85))
						PointMark(x: .value("Recorded", point.date), y: .value(title, v))
							.foregroundStyle(Theme.fg)
							.symbolSize(point.id == selected?.id ? 70 : 22)
					}
					if everyJump {
						ForEach(Array(point.jumps.enumerated()), id: \.offset) { _, jump in
							if let v = value(jump), v != value(point.best) {
								PointMark(x: .value("Recorded", point.date), y: .value(title, v))
									.foregroundStyle(Theme.fgMuted.opacity(0.7)).symbolSize(12)
							}
						}
					}
				}
				if let selected { RuleMark(x: .value("Selected", selected.date)).foregroundStyle(Theme.fgMuted.opacity(0.5)) }
			}
			.chartYScale(domain: domain)
			.chartXSelection(value: Binding(get: { selected?.date }, set: { date in
				guard let date else { return }
				self.selected = charted.min { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) }?.id
			}))
			.frame(height: 170)
			}
		}
	}

	private func detail(_ point: TrendPoint) -> some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack {
				Text(point.date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year())).font(.system(size: 13, weight: .semibold))
				Text(point.session.title).font(.system(size: 13)).foregroundStyle(Theme.fgMuted).lineLimit(1)
				Spacer()
				Button("Results") {
					close()
					app.showResults(point.session)
				}
				.buttonStyle(.plain).font(.system(size: 13, weight: .medium))
			}
			HStack(spacing: 14) {
				Text("Session best").font(.system(size: 12, weight: .medium))
				(Text("Flight ") + Text("\(Int(point.best.flightMs.rounded())) ms").fontWeight(.semibold)).font(.system(size: 12))
				if let c = point.best.contactMs { (Text("Contact ") + Text("\(Int(c.rounded())) ms").fontWeight(.semibold)).font(.system(size: 12)) }
				if point.jumps.count > 1 { Text("best of \(point.jumps.count) jumps").font(.system(size: 12)).foregroundStyle(Theme.fgMuted) }
			}
			ForEach(Array(point.jumps.enumerated()), id: \.offset) { index, jump in
				Text("Jump \(index + 1) · Flight \(Int(jump.flightMs.rounded())) ms" + (jump.contactMs.map { " · Contact \(Int($0.rounded())) ms" } ?? ""))
					.font(.system(size: 12)).foregroundStyle(Theme.fgSecondary)
			}
		}
		.padding(14)
		.background(RoundedRectangle(cornerRadius: 10).fill(Theme.surface))
	}
}

struct KeybindsSheet: View {
	@Environment(\.dismiss) private var dismiss
	@AppStorage(Hint.hiddenKey) private var hintHidden = false

	private let groups: [(String, [(String, String)])] = [
		("Playback", [("Play / pause", "Space / K"), ("Step back / forward a frame", ", / ."), ("Step a frame (arrow keys)", "← / →"), ("Volume up / down", "↑ / ↓"), ("Playback speed 1× / ½× / ¼×", "R"), ("Mute / unmute", "⇧ M"), ("Go to start / end", "Home / End")]),
		("Marks", [("Mark the step the Mark button names", "M"), ("Mark a takeoff", "T"), ("Mark a touchdown or landing", "L"), ("Previous / next mark", "[ / ]"), ("Delete mark at playhead", "Delete"), ("Undo mark change", "⌘ Z"), ("Redo mark change", "⇧ ⌘ Z"), ("Show / hide session results", "A")]),
		("General", [("Open a video", "⌘ O"), ("Save session", "⌘ S"), ("Saved sessions", "⌘ E"), ("Zoom the picture", "Pinch, ⌘ scroll, double click"), ("Show / hide keyboard shortcuts", "?"), ("Close this overlay", "Esc")]),
	]

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			HStack {
				Text("Keyboard shortcuts").font(.system(size: 16, weight: .semibold))
				Spacer()
				Button {
					dismiss()
				} label: {
					Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).frame(width: 24, height: 24)
				}
				.buttonStyle(.plain).keyboardShortcut(.cancelAction)
			}
			.padding(20)
			Divider().overlay(Theme.border)
			HStack(alignment: .top, spacing: 20) {
				ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
					VStack(alignment: .leading, spacing: 8) {
						Text(group.0).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.fgSecondary)
						VStack(spacing: 0) {
							ForEach(Array(group.1.enumerated()), id: \.offset) { index, bind in
								HStack {
									Text(bind.0).font(.system(size: 13))
									Spacer(minLength: 12)
									Text(bind.1).font(.system(size: 11, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.fgSecondary)
										.padding(.horizontal, 6).padding(.vertical, 3)
										.background(RoundedRectangle(cornerRadius: 4).fill(Theme.fg.opacity(0.07)))
								}
								.padding(.horizontal, 12).frame(height: 36)
								if index < group.1.count - 1 { Divider().overlay(Theme.border) }
							}
						}
						.card()
					}
					.frame(width: 300)
				}
			}
			.padding(20)
			HStack {
				Toggle("Show marking hints", isOn: Binding(get: { !hintHidden }, set: { $0 ? Hint.show() : (hintHidden = true) }))
					.toggleStyle(.switch).controlSize(.small)
				Spacer()
			}
			.padding(.horizontal, 20).padding(.bottom, 18)
		}
		.background(Theme.elevated)
	}
}

struct SettingsView: View {
	@Environment(AppModel.self) private var app
	@State private var folders: [URL] = []

	var body: some View {
		Form {
			Section {
				ForEach(folders, id: \.self) { folder in
					HStack {
						Image(systemName: "folder")
						Text(folder.path).lineLimit(1).truncationMode(.middle)
						Spacer()
						Button("Remove") {
							app.removeVideoFolder(folder)
							folders = app.videoFolders
						}
					}
				}
				Button("Add folder…") {
					app.addVideoFolder()
					folders = app.videoFolders
				}
			} header: {
				Text("Video folders")
			} footer: {
				Text("When a session's video isn't where it was last opened, Airtime looks for it here, by content, so renamed and moved files are found too.")
					.foregroundStyle(.secondary)
			}
			Section("Saved sessions") {
				LabeledContent("Stored in") {
					Button(app.store.root.path) { NSWorkspace.shared.activateFileViewerSelecting([app.store.root]) }.buttonStyle(.link)
				}
			}
		}
		.formStyle(.grouped)
		.frame(width: 520, height: 360)
		.onAppear { folders = app.videoFolders }
	}
}
