import AirtimeKit
import SwiftUI

enum Hint {
	static let hiddenKey = "markingGuideHidden"
	static let measuredKey = "measuredJumps"

	/// Counts a newly measured jump; the hint retires after three.
	static func noteMeasuredJump() {
		let defaults = UserDefaults.standard
		let count = defaults.integer(forKey: measuredKey) + 1
		defaults.set(count, forKey: measuredKey)
		if count >= hintRetiresAfter { defaults.set(true, forKey: hiddenKey) }
	}

	static func show() {
		UserDefaults.standard.set(false, forKey: hiddenKey)
		UserDefaults.standard.set(0, forKey: measuredKey)
	}
}

/// The jump at the playhead: its flight time first, its three marks, and the controls for the
/// mark on screen. Below, every jump in this video.
struct JumpPanel: View {
	@Environment(AppModel.self) private var app
	var workspace: Workspace
	@AppStorage(Hint.hiddenKey) private var hintHidden = false

	var body: some View {
		let units = workspace.units
		let timing = workspace.timing
		let active = unitAt(units, frame: workspace.player.frame, timing: timing)
		let number = active.flatMap { a in units.firstIndex { $0.id == a.id } }.map { $0 + 1 } ?? max(1, units.count)
		let completed = units.filter { $0.flight != nil }
		let best = bestUnit(units)
		let onFrame = workspace.markOnFrame
		let jumpType = workspace.jumpType

		VStack(alignment: .leading, spacing: 0) {
			ScrollView {
				VStack(alignment: .leading, spacing: 16) {
					HStack {
						Text("Jump \(number)").font(.system(size: 15, weight: .semibold))
						if let active, !bestFlightLabel(active, completed: completed, best: best).isEmpty, completed.count > 1 {
							Badge(text: bestFlightLabel(active, completed: completed, best: best))
						}
						Spacer()
						Button {
							app.screen = .results
						} label: {
							HStack(spacing: 4) {
								Text("Results")
								Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
							}
						}
						.buttonStyle(.plain)
						.help("Session results (A)")
					}
					VStack(alignment: .leading, spacing: 6) {
						Text("Flight time").font(.system(size: 13)).foregroundStyle(Theme.fgMuted)
						if let flight = active?.flight {
							Measure(value: ms(flight.realSeconds), size: 52, weight: .semibold)
								.contentTransition(.numericText())
						} else {
							RoundedRectangle(cornerRadius: 2).fill(Theme.fgMuted.opacity(0.6)).frame(width: 28, height: 4).frame(height: 62, alignment: .center)
						}
						Group {
							if let contact = active?.contact {
								(Text("Contact ") + Text("\(ms(contact.realSeconds)) ms").fontWeight(.semibold).foregroundColor(Theme.fg))
							} else if active?.flight != nil {
								Text("No \(plantLabel(jumpType).lowercased()) · contact not measured")
							} else if case .add(let step) = workspace.action {
								Text("Next: \(step.label(jumpType).lowercased())")
							} else {
								Text(" ")
							}
						}
						.font(.system(size: 13))
						.foregroundStyle(Theme.fgSecondary)
					}
					slots(active, onFrame: onFrame)
					editRow(active, onFrame: onFrame)
					if units.count > 1 {
						VStack(alignment: .leading, spacing: 4) {
							Text("This video").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.fgMuted).padding(.bottom, 2)
							ForEach(Array(units.enumerated()), id: \.element.id) { index, unit in
								Button {
									if let mark = unit.takeoff ?? unit.plant { workspace.seek(to: mark) }
								} label: {
									HStack {
										Text("Jump \(index + 1)").font(.system(size: 13))
										let label = bestFlightLabel(unit, completed: completed, best: best)
										if !label.isEmpty { Badge(text: label) }
										Spacer()
										if let flight = unit.flight {
											Measure(value: ms(flight.realSeconds), size: 13, weight: .semibold)
										} else {
											Text("Incomplete").font(.system(size: 12)).foregroundStyle(Theme.fgMuted)
										}
									}
									.padding(.horizontal, 12)
									.frame(height: 36)
									.background(RoundedRectangle(cornerRadius: 8).fill(unit.id == active?.id ? Theme.fg.opacity(0.07) : .clear))
									.contentShape(Rectangle())
								}
								.buttonStyle(.plain)
							}
						}
					}
					let stray = unpairedMarks(workspace.marks, units)
					if !stray.isEmpty {
						Text("\(stray.count) unpaired mark\(stray.count == 1 ? "" : "s"): \(stray.map { workspace.markName($0).lowercased() }.joined(separator: ", ")). Use [ and ] to find \(stray.count == 1 ? "it" : "them").")
							.font(.system(size: 12)).foregroundStyle(Theme.warning.opacity(0.9))
					}
				}
				.padding(20)
			}
			if !hintHidden {
				HStack(alignment: .top) {
					Text(hintText).font(.system(size: 12)).foregroundStyle(Theme.fgSecondary).fixedSize(horizontal: false, vertical: true)
					Spacer()
					Button("Got it") { hintHidden = true }.buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(Theme.fgMuted)
				}
				.padding(.horizontal, 20)
				.padding(.vertical, 14)
				.overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
			}
		}
	}

	private var hintText: String {
		switch workspace.action {
		case .onFrame(let step, _): "Selected frame · " + step.definition(workspace.jumpType)
		case .add(let step): "\(step.label(workspace.jumpType)) · " + step.definition(workspace.jumpType)
		case .choose: "Nothing obvious belongs on this frame: choose which mark it is."
		}
	}

	@ViewBuilder
	private func slots(_ unit: JumpUnit?, onFrame: Mark?) -> some View {
		let entries: [(MarkStep, Mark?)] = [(.plant, unit?.plant), (.takeoff, unit?.takeoff), (.landing, unit?.landing)]
		VStack(spacing: 0) {
			ForEach(Array(entries.enumerated()), id: \.offset) { index, entry in
				let (step, mark) = entry
				let current = mark != nil && mark?.id == onFrame?.id
				Button {
					if let mark { workspace.seek(to: mark) }
				} label: {
					HStack(spacing: 10) {
						MarkGlyph(type: step.markType, size: 16).foregroundStyle(mark == nil ? Theme.fgMuted : Theme.fg)
						Text(step.label(workspace.jumpType)).font(.system(size: 13, weight: current ? .semibold : .medium))
							.foregroundStyle(mark == nil ? Theme.fgMuted : Theme.fg)
						Spacer()
						Text(mark.map { workspace.timing.clock(ofFrame: workspace.timing.frame(ofMarkTime: $0.time)) } ?? "Not marked")
							.font(.system(size: 12, design: mark == nil ? .default : .monospaced))
							.foregroundStyle(mark == nil ? Theme.fgMuted : Theme.fgSecondary)
					}
					.padding(.horizontal, 14)
					.frame(height: 44)
					.background(current ? Theme.fg.opacity(0.08) : .clear)
					.overlay(alignment: .leading) { if current { Rectangle().fill(Theme.fg).frame(width: 2) } }
					.contentShape(Rectangle())
				}
				.buttonStyle(.plain)
				.disabled(mark == nil)
				.help(mark == nil ? "" : "Go to this frame")
				if index < 2 { Divider().overlay(Theme.border) }
			}
		}
		.background(Theme.surface.opacity(0.5))
		.clipShape(RoundedRectangle(cornerRadius: 10))
		.overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border))
	}

	@ViewBuilder
	private func editRow(_ unit: JumpUnit?, onFrame: Mark?) -> some View {
		HStack(spacing: 6) {
			if let mark = onFrame {
				if unit?.marks.contains(where: { $0.id == mark.id }) != true {
					Text(workspace.markName(mark)).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.fgSecondary)
				}
				Button("−1") { workspace.nudge(mark, by: -1) }.buttonStyle(QuietButtonStyle())
					.disabled(workspace.nudgeBlocked(mark, by: -1) != nil).help(workspace.nudgeBlocked(mark, by: -1) ?? "One frame earlier")
				Button("+1") { workspace.nudge(mark, by: 1) }.buttonStyle(QuietButtonStyle())
					.disabled(workspace.nudgeBlocked(mark, by: 1) != nil).help(workspace.nudgeBlocked(mark, by: 1) ?? "One frame later")
				Button {
					workspace.remove(mark)
				} label: {
					Label("Remove", systemImage: "trash")
				}
				.buttonStyle(QuietButtonStyle(destructive: true))
				.help("Remove this mark (Delete)")
			}
			Spacer()
			Button {
				workspace.undo()
			} label: {
				Label("Undo", systemImage: "arrow.uturn.backward")
			}
			.buttonStyle(QuietButtonStyle())
			.disabled(workspace.history.isEmpty)
			.help("Undo the last mark change (⌘Z)")
			if !workspace.future.isEmpty {
				Button {
					workspace.redo()
				} label: {
					Label("Redo", systemImage: "arrow.uturn.forward")
				}
				.buttonStyle(QuietButtonStyle())
				.help("Redo (⇧⌘Z)")
			}
		}
	}
}

struct Badge: View {
	var text: String
	var body: some View {
		Text(text).font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.fgSecondary)
			.padding(.horizontal, 7).padding(.vertical, 2)
			.background(Capsule().fill(Theme.fg.opacity(0.1)))
	}
}
