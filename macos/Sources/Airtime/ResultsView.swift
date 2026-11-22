import AirtimeKit
import SwiftUI

/// Everything a session measured, and its details. For the open video it edits the session being
/// marked; for a saved session without its video, edits save straight away.
struct ResultsView: View {
	@Environment(AppModel.self) private var app
	var workspace: Workspace?
	var sessionId: String?

	var body: some View {
		if let workspace {
			ResultsBody(
				marks: workspace.marks, timing: workspace.timing, precisionNote: precisionNote(fps: workspace.timing.fps, scale: workspace.timeScale, saved: false),
				fields: SessionFields(
					title: Binding(get: { workspace.title }, set: { workspace.title = $0 }),
					jumpType: Binding(get: { workspace.jumpType }, set: { workspace.jumpType = $0 }),
					timeScale: Binding(get: { workspace.timeScale }, set: { workspace.timeScale = $0 }),
					recordedAt: Binding(get: { workspace.recordedAt }, set: { workspace.recordedAt = $0 }),
					notes: Binding(get: { workspace.notes }, set: { workspace.notes = $0 })),
				back: ("Video", { app.screen = .player }),
				trailing: nil,
				openJump: { mark in
					app.screen = .player
					workspace.seek(to: mark)
				})
		} else if let sessionId, let session = app.session(id: sessionId) {
			SavedResults(session: session)
		} else {
			Text("This session was deleted.").foregroundStyle(Theme.fgMuted).frame(maxWidth: .infinity, maxHeight: .infinity)
		}
	}
}

func precisionNote(fps: Double, scale: Double, saved: Bool) -> String {
	let frame = String(format: "%.1f", 1000 / fps * scale)
	return saved ? "Estimated from the saved frame rate: ±\(frame) ms per frame." : "Read from frames: ±\(frame) ms per frame."
}

private struct SavedResults: View {
	@Environment(AppModel.self) private var app
	@State var session: Session

	var body: some View {
		ResultsBody(
			marks: session.marks, timing: session.savedTiming, precisionNote: precisionNote(fps: session.frameRate.value, scale: session.timeScale, saved: true),
			fields: SessionFields(
				title: binding(\.title), jumpType: binding(\.jumpType), timeScale: binding(\.timeScale),
				recordedAt: binding(\.recordedAt), notes: binding(\.notes)),
			back: ("Home", { app.screen = .home }),
			trailing: ("Open video", { Task { await app.openVideo(for: session) } }),
			openJump: { mark in Task { await app.openVideo(for: session, atMark: mark.time) } })
	}

	private func binding<T: Equatable>(_ path: WritableKeyPath<Session, T>) -> Binding<T> {
		Binding(get: { session[keyPath: path] }, set: { value in
			guard session[keyPath: path] != value else { return }
			session[keyPath: path] = value
			app.update(session)
		})
	}
}

struct SessionFields {
	var title: Binding<String>
	var jumpType: Binding<JumpType?>
	var timeScale: Binding<Double>
	var recordedAt: Binding<String>
	var notes: Binding<String>
}

private struct ResultsBody: View {
	var marks: [Mark]
	var timing: Timing
	var precisionNote: String
	var fields: SessionFields
	var back: (String, () -> Void)
	var trailing: (String, () -> Void)?
	var openJump: (Mark) -> Void

	var body: some View {
		let sorted = sortMarks(marks)
		let analysis = analyzeMarks(sorted, timing: timing, timeScale: fields.timeScale.wrappedValue, jumpType: fields.jumpType.wrappedValue)
		let units = jumpUnits(sorted, analysis)
		let completed = units.filter { $0.flight != nil }
		let best = bestUnit(units)
		let date = isoDate(fields.recordedAt.wrappedValue)

		VStack(spacing: 0) {
			ZStack {
				Text("Results").font(.system(size: 14, weight: .semibold))
				HStack {
					Button(action: back.1) {
						HStack(spacing: 4) {
							Image(systemName: "chevron.left").font(.system(size: 12, weight: .semibold))
							Text(back.0)
						}
					}
					.buttonStyle(.plain).keyboardShortcut(.cancelAction)
					Spacer()
					if let trailing { Button(trailing.0, action: trailing.1).buttonStyle(.plain).fontWeight(.medium) }
				}
			}
			.font(.system(size: 14))
			.padding(.horizontal, 24)
			.frame(height: 52)
			.overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 1) }

			ScrollView {
				HStack(alignment: .top, spacing: 64) {
					VStack(alignment: .leading, spacing: 28) {
						VStack(alignment: .leading, spacing: 6) {
							Text(fields.title.wrappedValue.isEmpty ? "Untitled" : fields.title.wrappedValue).font(.system(size: 30, weight: .semibold)).lineLimit(2)
							Text(([ "\(completed.count) jump\(completed.count == 1 ? "" : "s")", fields.jumpType.wrappedValue?.label, date?.mediumDate ] as [String?]).compactMap { $0 }.joined(separator: " · "))
								.font(.system(size: 15)).foregroundStyle(Theme.fgSecondary)
						}
						if let best, let flight = best.flight {
							HStack(alignment: .bottom, spacing: 56) {
								VStack(alignment: .leading, spacing: 4) {
									let label = bestFlightLabel(best, completed: completed, best: best)
									let index = (units.firstIndex { $0.id == best.id } ?? 0) + 1
									Text(label == "Joint best" ? "Joint best flight" : "Best flight · Jump \(index)").font(.system(size: 13)).foregroundStyle(Theme.fgSecondary)
									Measure(value: ms(flight.realSeconds), size: 76, weight: .semibold)
								}
								if completed.count > 1, let average = averageFlight(units) {
									VStack(alignment: .leading, spacing: 4) {
										Text("Average flight").font(.system(size: 13)).foregroundStyle(Theme.fgSecondary)
										Measure(value: ms(average), size: 34, weight: .semibold, color: Theme.fgSecondary)
									}
									.padding(.bottom, 8)
								}
							}
						} else {
							Text("No completed jumps yet. Mark a takeoff and its landing to measure a flight.")
								.font(.system(size: 14)).foregroundStyle(Theme.fgSecondary)
						}
						if !units.isEmpty {
							jumpsTable(units: units, completed: completed, best: best)
						}
						if completed.count > 1, let longest = best?.flight?.realSeconds {
							VStack(alignment: .leading, spacing: 10) {
								Text("Flight by jump").font(.system(size: 15, weight: .semibold))
								VStack(spacing: 14) {
									ForEach(Array(units.enumerated()), id: \.element.id) { index, unit in
										if let flight = unit.flight {
											let isBest = !bestFlightLabel(unit, completed: completed, best: best).isEmpty
											HStack(spacing: 16) {
												Text("Jump \(index + 1)").font(.system(size: 13)).foregroundStyle(isBest ? Theme.fg : Theme.fgSecondary).frame(width: 64, alignment: .leading)
												GeometryReader { geo in
													ZStack(alignment: .leading) {
														Capsule().fill(Theme.fg.opacity(0.08))
														Capsule().fill(isBest ? Theme.fg.opacity(0.9) : Theme.fg.opacity(0.4))
															.frame(width: geo.size.width * flight.realSeconds / longest)
													}
												}
												.frame(height: 6)
												Measure(value: ms(flight.realSeconds), size: 13, weight: .semibold).frame(width: 64, alignment: .trailing)
											}
										}
									}
								}
								.padding(16)
								.card()
							}
						}
					}
					.frame(maxWidth: 680, alignment: .leading)
					SessionForm(fields: fields)
						.frame(width: 344)
						.fixedSize(horizontal: false, vertical: true)
				}
				.padding(.horizontal, 40)
				.padding(.vertical, 40)
				.frame(maxWidth: 1180)
				.frame(maxWidth: .infinity)
			}
		}
	}

	private func jumpsTable(units: [JumpUnit], completed: [JumpUnit], best: JumpUnit?) -> some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("Jumps").font(.system(size: 15, weight: .semibold))
			VStack(spacing: 0) {
				HStack {
					Text("Jump").frame(maxWidth: .infinity, alignment: .leading)
					Text("Flight").frame(width: 100, alignment: .trailing)
					Text("Contact").frame(width: 110, alignment: .trailing)
					Text("RSI").frame(width: 90, alignment: .trailing)
					Spacer().frame(width: 34)
				}
				.font(.system(size: 12)).foregroundStyle(Theme.fgMuted)
				.padding(.horizontal, 16).frame(height: 32)
				ForEach(Array(units.enumerated()), id: \.element.id) { index, unit in
					Divider().overlay(Theme.border)
					Button {
						if let mark = unit.takeoff ?? unit.plant { openJump(mark) }
					} label: {
						HStack {
							HStack(spacing: 8) {
								Text("Jump \(index + 1)").font(.system(size: 15, weight: .medium))
								let label = bestFlightLabel(unit, completed: completed, best: best)
								if !label.isEmpty { Text(label).font(.system(size: 12)).foregroundStyle(Theme.fgSecondary) }
							}
							.frame(maxWidth: .infinity, alignment: .leading)
							Group {
								if let flight = unit.flight { Measure(value: ms(flight.realSeconds), size: 17, weight: .semibold) } else { Text("Incomplete").font(.system(size: 12)).foregroundStyle(Theme.fgMuted) }
							}
							.frame(width: 100, alignment: .trailing)
							Group {
								if let contact = unit.contact { Measure(value: ms(contact.realSeconds), size: 14, weight: .regular, color: Theme.fgSecondary) } else { Text("–").foregroundStyle(Theme.fgMuted) }
							}
							.frame(width: 110, alignment: .trailing)
							Group {
								let jump = Jump(takeoff: unit.takeoff ?? unit.plant!, landing: unit.landing, contact: unit.contact, flight: unit.flight)
								if let value = rsi(jump) { Text(String(format: "%.2f", value)).font(Theme.number(14, weight: .regular)).foregroundStyle(Theme.fgSecondary) } else { Text("–").foregroundStyle(Theme.fgMuted) }
							}
							.frame(width: 90, alignment: .trailing)
							Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.fgMuted).frame(width: 34)
						}
						.padding(.horizontal, 16)
						.frame(height: 52)
						.contentShape(Rectangle())
					}
					.buttonStyle(RowButtonStyle())
					.help("Open this jump in the video")
				}
			}
			.card()
			Text(units.contains { $0.contact != nil } ? "\(precisionNote) RSI is jump height over the contact before it." : precisionNote)
				.font(.system(size: 12)).foregroundStyle(Theme.fgMuted)
		}
	}
}

/// The session's details as grouped rows: label left, value right, edited in place.
private struct SessionForm: View {
	var fields: SessionFields
	@State private var editingDate = false

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text("Session").font(.system(size: 15, weight: .semibold))
			VStack(spacing: 0) {
				row("Title") {
					TextField("Title", text: fields.title).textFieldStyle(.plain).multilineTextAlignment(.trailing)
				}
				Divider().overlay(Theme.border)
				row("Jump type") {
					Menu {
						Picker("Jump type", selection: fields.jumpType) {
							ForEach(JumpType.allCases) { Text($0.label).tag(Optional($0)) }
							if fields.jumpType.wrappedValue == nil { Text("Not set").tag(JumpType?.none) }
						}
						.pickerStyle(.inline)
					} label: {
						menuLabel(fields.jumpType.wrappedValue?.label ?? "Not set")
					}
					.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
				}
				Divider().overlay(Theme.border)
				row("Footage") {
					Menu {
						Picker("Footage", selection: fields.timeScale) {
							ForEach(timeScales) { Text($0.label).tag($0.value) }
						}
						.pickerStyle(.inline)
					} label: {
						menuLabel(timeScales.first { $0.value == fields.timeScale.wrappedValue }?.label ?? "Real time")
					}
					.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
				}
				Divider().overlay(Theme.border)
				row("Recorded") {
					Button {
						editingDate = true
					} label: {
						menuLabel(isoDate(fields.recordedAt.wrappedValue)?.dateTime ?? "Not set")
					}
					.buttonStyle(.plain)
					.popover(isPresented: $editingDate, arrowEdge: .bottom) {
						let date = Binding<Date>(
							get: { isoDate(fields.recordedAt.wrappedValue) ?? Date() },
							set: { fields.recordedAt.wrappedValue = ISODate.string($0) })
						VStack(alignment: .leading, spacing: 10) {
							DatePicker("Date", selection: date, displayedComponents: .date).datePickerStyle(.graphical).labelsHidden()
							DatePicker("Time", selection: date, displayedComponents: .hourAndMinute).labelsHidden()
						}
						.padding(14)
					}
				}
			}
			.font(.system(size: 14))
			.card()
			Text("Recorded starts as the date the camera wrote into the video, or the file's date.")
				.font(.system(size: 12)).foregroundStyle(Theme.fgMuted).padding(.horizontal, 2)
			VStack(alignment: .leading, spacing: 6) {
				Text("Notes").font(.system(size: 14))
				ZStack(alignment: .topLeading) {
					if fields.notes.wrappedValue.isEmpty {
						Text("Exercise, attempt, how it felt…").foregroundStyle(Theme.fgMuted).padding(.top, 1).padding(.leading, 5)
					}
					TextEditor(text: fields.notes).scrollContentBackground(.hidden).frame(minHeight: 70, maxHeight: 160)
				}
				.font(.system(size: 14))
			}
			.padding(14)
			.card()
			.padding(.top, 8)
		}
	}

	private func row<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
		HStack(spacing: 16) {
			Text(label).foregroundStyle(Theme.fgSecondary)
			Spacer(minLength: 8)
			content()
		}
		.padding(.horizontal, 16)
		.frame(height: 44)
	}

	private func menuLabel(_ text: String) -> some View {
		// One Text, so a menu's label keeps the chevron after the value.
		(Text(text).foregroundColor(Theme.fg) + Text("  ") + Text(Image(systemName: "chevron.up.chevron.down")).font(.system(size: 10, weight: .semibold)).foregroundColor(Theme.fgMuted))
	}
}
