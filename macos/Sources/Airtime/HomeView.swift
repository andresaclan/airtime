import AirtimeKit
import Charts
import SwiftUI

/// The start screen. First visit: how marking works and where to open a video. Returning: the
/// latest flight trend, recent sessions (opened straight on their video, wherever it is now),
/// and any unsaved work to resume.
struct HomeView: View {
	@Environment(AppModel.self) private var app

	var body: some View {
		ScrollView {
			VStack(spacing: 12) {
				if app.sessions.isEmpty && app.drafts.isEmpty {
					firstVisit
				} else {
					openCard.card()
					if !app.drafts.isEmpty { unsavedCard }
					if let group = latestGroup(trendGroups(app.sessions)) { TrendCard(group: group) }
					recentCard
				}
				HStack {
					Label("Videos stay on your Mac", systemImage: "lock").font(.system(size: 12)).foregroundStyle(Theme.fgMuted)
					Spacer()
					if app.sessions.isEmpty {
						Text("Have a backup from the web app?").font(.system(size: 12)).foregroundStyle(Theme.fgMuted)
						Button("Import backup") { app.importBackup() }.buttonStyle(.plain).font(.system(size: 12, weight: .medium))
					} else {
						Button("How marking works") { app.showKeybinds = true }.buttonStyle(.plain).font(.system(size: 12, weight: .medium))
					}
				}
				.padding(.horizontal, 4)
			}
			.frame(maxWidth: 560)
			.padding(.vertical, 40)
			.frame(maxWidth: .infinity)
		}
	}

	private var openCard: some View {
		HStack(spacing: 14) {
			Image(systemName: "square.and.arrow.up").font(.system(size: 14)).frame(width: 36, height: 36)
				.background(RoundedRectangle(cornerRadius: 8).fill(Theme.fg.opacity(0.05)))
				.overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.border))
			VStack(alignment: .leading, spacing: 2) {
				Text("Open a jump video").font(.system(size: 14, weight: .medium))
				Text("Drag a clip here, or browse your files").font(.system(size: 13)).foregroundStyle(Theme.fgMuted)
			}
			Spacer()
			if let opening = app.opening {
				ProgressView().controlSize(.small)
				Text("Opening \(opening)…").font(.system(size: 12)).foregroundStyle(Theme.fgMuted).lineLimit(1)
			} else {
				Button("Choose video") { app.chooseVideo() }.buttonStyle(QuietButtonStyle(prominent: false))
					.overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.borderHover))
					.keyboardShortcut("o")
			}
		}
		.padding(20)
	}

	private var firstVisit: some View {
		VStack(alignment: .leading, spacing: 0) {
			VStack(alignment: .leading, spacing: 4) {
				Text("Time your jumps from video").font(.system(size: 16, weight: .semibold))
				Text("Open an approach jump and mark takeoff and landing to measure flight time.").font(.system(size: 13)).foregroundStyle(Theme.fgSecondary)
			}
			.padding(20)
			Divider().overlay(Theme.border)
			openCard.background(Theme.bg.opacity(0.6))
			Divider().overlay(Theme.border)
			VStack(alignment: .leading, spacing: 12) {
				JumpDiagram().frame(height: 90)
				ForEach(Array(MarkStep.allCases.enumerated()), id: \.offset) { index, step in
					HStack(spacing: 12) {
						Text("\(index + 1)").font(.system(size: 11, weight: .medium)).frame(width: 18, height: 18).background(Circle().fill(Theme.fg.opacity(0.08)))
						Text(step.label(.approach)).font(.system(size: 13, weight: .medium)).frame(width: 90, alignment: .leading)
						Text(step.definition(.approach)).font(.system(size: 13)).foregroundStyle(Theme.fgSecondary)
						Spacer()
						MarkGlyph(type: step.markType, size: 14).padding(4).overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Theme.borderHover))
					}
				}
			}
			.padding(20)
			Divider().overlay(Theme.border)
			Text("Mark takeoff and landing for flight time. Add the plant step for contact time and reactive strength index (RSI).")
				.font(.system(size: 12)).foregroundStyle(Theme.fgSecondary).padding(20)
		}
		.card()
	}

	private var unsavedCard: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("Unsaved work").font(.system(size: 15, weight: .semibold)).padding(.bottom, 4)
			ForEach(app.drafts.prefix(3), id: \.fingerprint) { draft in
				HStack {
					VStack(alignment: .leading, spacing: 2) {
						Text(draft.session.title).font(.system(size: 14, weight: .medium))
						Text("Edited \(isoDate(draft.updatedAt)?.dateTime ?? "") · \(draft.session.marks.count) mark\(draft.session.marks.count == 1 ? "" : "s")")
							.font(.system(size: 12)).foregroundStyle(Theme.fgMuted)
					}
					Spacer()
					Button("Discard") { app.discard(draft) }.buttonStyle(QuietButtonStyle())
					Button("Resume") { app.resume(draft) }.buttonStyle(QuietButtonStyle(prominent: true))
				}
			}
		}
		.padding(18)
		.card()
	}

	private var recentCard: some View {
		VStack(alignment: .leading, spacing: 0) {
			HStack {
				Text("Recent sessions").font(.system(size: 16, weight: .medium))
				Spacer()
				Button {
					app.sessionsTab = .list
					app.showSessions = true
				} label: {
					HStack(spacing: 4) {
						Text("Sessions")
						Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
					}
				}
				.buttonStyle(.plain)
			}
			.padding(.horizontal, 16).padding(.top, 18).padding(.bottom, 8)
			if !app.sessions.isEmpty {
				HStack {
					Spacer()
					Text("Best flight").font(.system(size: 12)).foregroundStyle(Theme.fgMuted).padding(.trailing, 36)
				}
				.padding(.horizontal, 16)
			}
			let recent = app.sessions.sorted { $0.recordedAt > $1.recordedAt }.prefix(3)
			ForEach(Array(recent.enumerated()), id: \.element.id) { index, session in
				let summary = sessionSummary(session)
				Button {
					app.openSession(session)
				} label: {
					HStack {
						VStack(alignment: .leading, spacing: 3) {
							Text(session.title).font(.system(size: 14, weight: .medium)).lineLimit(1)
							Text("Recorded \(isoDate(session.recordedAt)?.mediumDate ?? "–") · \(summary.jumps) jump\(summary.jumps == 1 ? "" : "s")")
								.font(.system(size: 12)).foregroundStyle(Theme.fgMuted)
						}
						Spacer()
						if let best = summary.bestFlightMs {
							Measure(value: String(Int(best.rounded())), size: 16, weight: .medium)
						}
						Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.fgMuted).padding(.leading, 8)
					}
					.padding(.horizontal, 16)
					.frame(height: 60)
					.contentShape(Rectangle())
				}
				.buttonStyle(RowButtonStyle())
				.help("Open \(session.media.fileName)")
				.contextMenu {
					Button("Open video") { app.openSession(session) }
					Button("Results") { app.showResults(session) }
					Button("Show video in Finder") {
						if let url = app.store.locateVideo(fingerprint: session.media.fingerprint, sizeBytes: session.media.sizeBytes) {
							NSWorkspace.shared.activateFileViewerSelecting([url])
						}
					}
				}
				if index < recent.count - 1 { Divider().overlay(Theme.border).padding(.horizontal, 8) }
			}
			Spacer().frame(height: 6)
		}
		.card()
	}
}

struct RowButtonStyle: ButtonStyle {
	@State private var hovering = false
	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.background(RoundedRectangle(cornerRadius: 8).fill(Theme.fg.opacity(configuration.isPressed ? 0.08 : hovering ? 0.04 : 0)).padding(.horizontal, 6))
			.onHover { hovering = $0 }
	}
}

/// The latest jump type's flight time, best jump per session, as on the web home screen.
struct TrendCard: View {
	@Environment(AppModel.self) private var app
	var group: TrendGroup

	var body: some View {
		let points = group.points
		let latest = points.last!
		let first = points.first!
		VStack(alignment: .leading, spacing: 6) {
			HStack {
				(Text("Flight time").fontWeight(.medium) + Text(" · \(group.label)").foregroundColor(Theme.fgMuted)).font(.system(size: 13))
				Spacer()
				Button {
					app.sessionsTab = .trends
					app.showSessions = true
				} label: {
					HStack(spacing: 4) {
						Text("Trends")
						Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
					}
				}
				.buttonStyle(.plain).font(.system(size: 13))
			}
			Measure(value: String(Int(latest.best.flightMs.rounded())), size: 44, weight: .semibold)
			HStack(spacing: 6) {
				Text("Best jump on \(latest.date.mediumDate)")
				if points.count > 1 {
					let change = Int((latest.best.flightMs - first.best.flightMs).rounded())
					Text("·")
					(Text("\(change >= 0 ? "+" : "−")\(abs(change)) ms").fontWeight(.semibold).foregroundColor(Theme.fg) + Text(" since \(first.date.mediumDate)"))
				}
			}
			.font(.system(size: 12)).foregroundStyle(Theme.fgSecondary)
			if points.count > 1 {
				Chart(points) { point in
					LineMark(x: .value("Recorded", point.date), y: .value("Flight", point.best.flightMs))
						.foregroundStyle(Theme.fgMuted)
					PointMark(x: .value("Recorded", point.date), y: .value("Flight", point.best.flightMs))
						.foregroundStyle(point.id == latest.id ? Theme.fg : Theme.fgMuted)
						.symbolSize(point.id == latest.id ? 50 : 14)
				}
				.chartYScale(domain: .automatic(includesZero: false))
				.chartYAxis(.hidden)
				.chartXAxis(.hidden)
				.frame(height: 70)
				.padding(.top, 8)
				HStack {
					Text(first.date.mediumDate)
					Spacer()
					Text(latest.date.mediumDate)
				}
				.font(.system(size: 11)).foregroundStyle(Theme.fgMuted)
			}
		}
		.padding(20)
		.card()
	}
}

/// The run-up, the contact and the flight, numbered as the marks are.
struct JumpDiagram: View {
	var body: some View {
		Canvas { context, size in
			let y = size.height * 0.62
			let w = size.width
			var ground = Path()
			ground.move(to: CGPoint(x: 0, y: y))
			ground.addLine(to: CGPoint(x: w, y: y))
			context.stroke(ground, with: .color(Theme.border), lineWidth: 1)
			for x in [0.05, 0.13, 0.21] { context.fill(Path(ellipseIn: CGRect(x: w * x - 2, y: y - 2, width: 4, height: 4)), with: .color(Theme.fgMuted)) }
			let plant = w * 0.31, takeoff = w * 0.43, landing = w * 0.82
			var flight = Path()
			flight.move(to: CGPoint(x: takeoff, y: y))
			flight.addQuadCurve(to: CGPoint(x: landing, y: y), control: CGPoint(x: (takeoff + landing) / 2, y: y - size.height * 0.95))
			context.stroke(flight, with: .color(Theme.fgMuted), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
			var bracket = Path()
			bracket.move(to: CGPoint(x: plant, y: y + 6)); bracket.addLine(to: CGPoint(x: plant, y: y + 10))
			bracket.addLine(to: CGPoint(x: takeoff, y: y + 10)); bracket.addLine(to: CGPoint(x: takeoff, y: y + 6))
			context.stroke(bracket, with: .color(Theme.fgMuted), lineWidth: 1)
			for (n, x) in [(1, plant), (2, takeoff), (3, landing)] {
				context.fill(Path(ellipseIn: CGRect(x: x - 4.5, y: y - 4.5, width: 9, height: 9)), with: .color(n == 2 ? Theme.fg : Theme.landing))
				context.draw(Text("\(n)").font(.system(size: 11, weight: .semibold)), at: CGPoint(x: x, y: y - 18))
			}
			context.draw(Text("Run-up").font(.system(size: 11)).foregroundStyle(Theme.fgSecondary), at: CGPoint(x: w * 0.13, y: y + 22))
			context.draw(Text("Contact").font(.system(size: 11)).foregroundStyle(Theme.fgSecondary), at: CGPoint(x: (plant + takeoff) / 2, y: y + 22))
			context.draw(Text("Flight").font(.system(size: 11)).foregroundStyle(Theme.fgSecondary), at: CGPoint(x: (takeoff + landing) / 2, y: y - 18))
		}
	}
}
