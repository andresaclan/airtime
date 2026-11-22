import AirtimeKit
import AirtimePlayer
import SwiftUI

struct PlayerScreen: View {
	@Environment(AppModel.self) private var app
	var workspace: Workspace
	@State private var zoom: CGFloat = 1
	@State private var editing = false

	var body: some View {
		HStack(spacing: 0) {
			VStack(spacing: 0) {
				ZStack(alignment: .topTrailing) {
					VideoSurface(player: workspace.player, zoom: $zoom)
					if zoom > 1.01 {
						Button {
							zoom = 1
						} label: {
							Text("\(Int((zoom * 100).rounded()))% · Reset").font(.system(size: 12, weight: .medium))
						}
						.buttonStyle(QuietButtonStyle())
						.padding(10)
					}
				}
				.background(Theme.stage)
				VStack(spacing: 10) {
					TimelineView(workspace: workspace)
						.frame(height: 34)
					HStack(spacing: 0) {
						Spacer(minLength: 0)
						TransportDock(workspace: workspace, editing: $editing)
						Spacer(minLength: 0)
					}
				}
				.padding(.horizontal, 14)
				.padding(.top, 8)
				.padding(.bottom, 10)
				.background(Theme.bg)
				StatusBar(workspace: workspace)
			}
			Divider().overlay(Theme.border)
			JumpPanel(workspace: workspace)
				.frame(width: 352)
				.background(Theme.elevated)
		}
		.onChange(of: workspace.markOnFrame?.id) { editing = false }
		.onReceive(NotificationCenter.default.publisher(for: .airtimeEditMark)) { _ in editing = true }
	}
}

extension Notification.Name {
	static let airtimeEditMark = Notification.Name("airtime.editMark")
}

// MARK: - Timeline

/// The scrub bar: a drag scrubs (exact frame, chased), marks sit on it as pins that can be
/// dragged to another frame, and seconds are ticked underneath.
struct TimelineView: View {
	var workspace: Workspace
	@State private var draggingMark: String?
	@State private var dragFrame: Int?

	private var duration: Double { max(workspace.info.duration, 0.001) }

	var body: some View {
		GeometryReader { geo in
			let width = geo.size.width
			let x = { (t: Double) -> CGFloat in CGFloat(t / duration) * width }
			let playhead = x(workspace.player.isPlaying ? workspace.player.time : workspace.timing.startTime(ofFrame: workspace.player.frame))
			ZStack(alignment: .topLeading) {
				Canvas { context, size in
					let track = CGRect(x: 0, y: 9, width: size.width, height: 6)
					context.fill(Path(roundedRect: track, cornerRadius: 3), with: .color(Theme.fg.opacity(0.12)))
					context.fill(Path(roundedRect: CGRect(x: 0, y: 9, width: playhead, height: 6), cornerRadius: 3), with: .color(Theme.fg.opacity(0.75)))
					// Flights as brighter spans.
					for interval in workspace.analysis.intervals where interval.kind == .flight {
						let a = x(interval.from.time), b = x(interval.to.time)
						context.fill(Path(CGRect(x: a, y: 9, width: max(1, b - a), height: 6)), with: .color(Theme.fg.opacity(0.35)))
					}
					let step = tickStep(width: size.width)
					var t = step
					while t < duration {
						let px = x(t)
						context.fill(Path(CGRect(x: px, y: 17, width: 1, height: 4)), with: .color(Theme.fg.opacity(0.25)))
						let label = step >= 1 ? "\(Int(t))s" : String(format: "%.1fs", t)
						context.draw(Text(label).font(.system(size: 9)).foregroundStyle(Theme.fgMuted), at: CGPoint(x: px, y: 28))
						t += step
					}
				}
				ForEach(workspace.marks) { mark in
					let frame = draggingMark == mark.id ? (dragFrame ?? 0) : workspace.timing.frame(ofMarkTime: mark.time)
					Pin(type: mark.type, current: workspace.markOnFrame?.id == mark.id)
						.position(x: x(workspace.timing.startTime(ofFrame: frame)), y: 6)
						.help("\(workspace.markName(mark)) · drag to move")
						.gesture(
							DragGesture(minimumDistance: 2, coordinateSpace: .named("timeline"))
								.onChanged { value in
									draggingMark = mark.id
									let t = Double(max(0, min(width, value.location.x)) / width) * duration
									let f = workspace.timing.clamp(workspace.timing.frame(at: t), duration: duration)
									if !workspace.frameTaken(f, except: mark.id) {
										dragFrame = f
										workspace.player.scrub(to: workspace.timing.startTime(ofFrame: f))
									}
								}
								.onEnded { _ in
									if let f = dragFrame { workspace.move(mark, toFrame: f) }
									draggingMark = nil
									dragFrame = nil
								}
						)
						.onTapGesture { workspace.seek(to: mark) }
				}
				Rectangle().fill(Theme.fg).frame(width: 2, height: 16).position(x: playhead, y: 12).allowsHitTesting(false)
			}
			.contentShape(Rectangle())
			.coordinateSpace(name: "timeline")
			.gesture(
				DragGesture(minimumDistance: 0, coordinateSpace: .named("timeline"))
					.onChanged { value in
						let t = Double(max(0, min(width, value.location.x)) / width) * duration
						workspace.player.scrub(to: t)
					}
			)
			.accessibilityElement()
			.accessibilityLabel("Video timeline")
			.accessibilityValue(formatClock(workspace.player.time))
		}
	}

	private func tickStep(width: CGFloat) -> Double {
		for step in [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300] where width / CGFloat(duration / step) >= 60 {
			return step
		}
		return 600
	}
}

private struct Pin: View {
	var type: MarkType
	var current: Bool

	var body: some View {
		let color = type == .takeoff ? Theme.takeoff : Theme.landing
		ZStack {
			Path { p in
				if type == .takeoff {
					p.move(to: CGPoint(x: 6, y: 0)); p.addLine(to: CGPoint(x: 12, y: 7)); p.addLine(to: CGPoint(x: 0, y: 7)); p.closeSubpath()
				} else {
					p.move(to: CGPoint(x: 0, y: 0)); p.addLine(to: CGPoint(x: 12, y: 0)); p.addLine(to: CGPoint(x: 6, y: 7)); p.closeSubpath()
				}
			}
			.fill(color)
			.frame(width: 12, height: 7)
			.offset(y: -2)
			Rectangle().fill(color).frame(width: current ? 2 : 1.5, height: 12).offset(y: 6)
		}
		.scaleEffect(current ? 1.25 : 1)
		.frame(width: 18, height: 24)
		.contentShape(Rectangle())
	}
}

// MARK: - Transport and Mark buttons

struct TransportDock: View {
	@Environment(AppModel.self) private var app
	var workspace: Workspace
	@Binding var editing: Bool

	var body: some View {
		HStack(spacing: 4) {
			IconButton(symbol: "backward.frame.fill", help: "Previous frame (,)") { workspace.player.step(-1) }
				.accessibilityLabel("Previous frame")
			Button {
				workspace.player.togglePlay()
			} label: {
				Image(systemName: workspace.player.isPlaying ? "pause.fill" : "play.fill")
					.font(.system(size: 13, weight: .semibold))
					.frame(width: 32, height: 32)
					.background(Circle().fill(Theme.fg.opacity(0.1)))
			}
			.buttonStyle(.plain)
			.help("Play or pause (Space)")
			.accessibilityLabel(workspace.player.isPlaying ? "Pause" : "Play")
			IconButton(symbol: "forward.frame.fill", help: "Next frame (.)") { workspace.player.step(1) }
				.accessibilityLabel("Next frame")
			Divider().frame(height: 22).padding(.horizontal, 6)
			MarkButtons(workspace: workspace, editing: $editing)
				.frame(width: 372, alignment: .leading)
		}
		.padding(5)
		.background(RoundedRectangle(cornerRadius: 12).fill(Theme.surface))
		.overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border))
	}
}

struct IconButton: View {
	var symbol: String
	var help: String
	var action: () -> Void

	var body: some View {
		Button(action: action) {
			Image(systemName: symbol).font(.system(size: 12)).frame(width: 30, height: 30).contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.foregroundStyle(Theme.fg)
		.help(help)
	}
}

/// One button names the step that belongs at the frame on screen and marks it; a quieter one
/// marks the other type. A marked frame shows its mark, and pressing it opens the editor.
struct MarkButtons: View {
	var workspace: Workspace
	@Binding var editing: Bool

	var body: some View {
		let jumpType = workspace.jumpType
		HStack(spacing: 4) {
			switch workspace.action {
			case .add(let step):
				let other: MarkType = step.markType == .takeoff ? .landing : .takeoff
				let otherStep = other == .takeoff ? MarkStep.takeoff : landingStep
				Button {
					workspace.pressMark()
				} label: {
					HStack(spacing: 8) {
						MarkArc(step: step)
						Text("Mark \(step.label(jumpType).lowercased())").lineLimit(1)
						Spacer(minLength: 4)
						Text("M").font(.system(size: 10, weight: .semibold, design: .monospaced)).padding(.horizontal, 5).padding(.vertical, 2)
							.background(RoundedRectangle(cornerRadius: 4).fill(Color.black.opacity(0.12)))
					}
					.frame(maxWidth: .infinity)
				}
				.buttonStyle(QuietButtonStyle(prominent: true))
				.help("Mark \(step.label(jumpType).lowercased()) on this frame (M)")
				Button {
					workspace.place(other)
				} label: {
					HStack(spacing: 6) {
						MarkArc(step: otherStep)
						Text(otherStep.label(jumpType)).lineLimit(1)
					}
				}
				.buttonStyle(QuietButtonStyle())
				.help("Mark \(otherStep.label(jumpType).lowercased()) instead (\(other == .takeoff ? "T" : "L"))")
			case .onFrame(let step, let mark):
				if editing {
					let other: MarkType = mark.type == .takeoff ? .landing : .takeoff
					let otherStep = other == .takeoff ? MarkStep.takeoff : landingStep
					Button("−1") { workspace.nudge(mark, by: -1) }
						.buttonStyle(QuietButtonStyle()).disabled(workspace.nudgeBlocked(mark, by: -1) != nil)
						.help(workspace.nudgeBlocked(mark, by: -1) ?? "One frame earlier")
					Button("+1") { workspace.nudge(mark, by: 1) }
						.buttonStyle(QuietButtonStyle()).disabled(workspace.nudgeBlocked(mark, by: 1) != nil)
						.help(workspace.nudgeBlocked(mark, by: 1) ?? "One frame later")
					Button {
						workspace.place(other)
					} label: {
						Label(otherStep.label(jumpType), systemImage: "arrow.left.arrow.right").lineLimit(1)
					}
					.buttonStyle(QuietButtonStyle())
					.help("Change to \(otherStep.label(jumpType).lowercased())")
					Button {
						workspace.remove(mark)
					} label: {
						Image(systemName: "trash")
					}
					.buttonStyle(QuietButtonStyle(destructive: true))
					.help("Remove the \(step.label(jumpType).lowercased())")
					Spacer(minLength: 0)
					Button("Done") { editing = false }.buttonStyle(QuietButtonStyle(prominent: true))
				} else {
					Button {
						editing = true
					} label: {
						HStack(spacing: 8) {
							MarkArc(step: step)
							Text(step.label(jumpType))
							Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.fgSecondary)
							Spacer()
							Label("Edit", systemImage: "pencil").foregroundStyle(Theme.fgSecondary)
						}
						.frame(maxWidth: .infinity)
					}
					.buttonStyle(QuietButtonStyle())
					.help("Edit the \(step.label(jumpType).lowercased()) on this frame (M)")
				}
			case .choose:
				Button {
					workspace.place(.landing)
				} label: {
					HStack(spacing: 6) {
						MarkArc(step: landingStep)
						Text("Mark \(landingStep.label(jumpType).lowercased())").lineLimit(1)
					}
					.frame(maxWidth: .infinity)
				}
				.buttonStyle(QuietButtonStyle(prominent: true))
				Button {
					workspace.place(.takeoff)
				} label: {
					HStack(spacing: 6) {
						MarkArc(step: .takeoff)
						Text("Mark takeoff")
					}
				}
				.buttonStyle(QuietButtonStyle())
			}
		}
	}

	/// The step a landing-type mark would be here: a landing straight after a takeoff, else a plant.
	private var landingStep: MarkStep {
		let frame = workspace.player.frame
		let before = sortMarks(workspace.marks).last { workspace.timing.frame(ofMarkTime: $0.time) < frame }
		return before?.type == .takeoff ? .landing : .plant
	}
}

// MARK: - Status bar

struct StatusBar: View {
	var workspace: Workspace

	var body: some View {
		let player = workspace.player
		let timing = workspace.timing
		HStack(spacing: 10) {
			Text("\(timing.clock(ofFrame: player.frame)) / \(timing.durationClock(duration: workspace.info.duration))")
				.font(.system(size: 12, design: .monospaced))
			Divider().frame(height: 14)
			Text("frame \(timing.label(ofFrame: player.frame) + 1)").font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.fgSecondary)
			Divider().frame(height: 14)
			HStack(spacing: 5) {
				Circle().fill(workspace.info.frameRateSource == .container ? Theme.success : Theme.warning).frame(width: 6, height: 6)
				Text(fpsLabel).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.fgSecondary)
			}
			.help(fpsHelp)
			if workspace.timeScale != 1 {
				Divider().frame(height: 14)
				Text(timeScales.first { $0.value == workspace.timeScale }?.label ?? "").font(.system(size: 12)).foregroundStyle(Theme.warning)
					.help("Timings are scaled to real time for slow-motion footage. Change it in Results.")
			}
			Spacer()
			Button {
				let speeds: [Float] = [1, 0.5, 0.25]
				player.speed = speeds[((speeds.firstIndex(of: player.speed) ?? 0) + 1) % speeds.count]
			} label: {
				Text(player.speed == 1 ? "1×" : player.speed == 0.5 ? "½×" : "¼×").font(.system(size: 12, design: .monospaced)).frame(minWidth: 26)
			}
			.buttonStyle(QuietButtonStyle())
			.help("Playback speed (R). A viewing aid only: it never changes timings.")
			if workspace.info.hasAudio {
				VolumeControl(player: player)
			}
		}
		.padding(.horizontal, 14)
		.frame(height: 36)
		.background(Theme.bg)
		.overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
	}

	private var fpsLabel: String {
		let fps = workspace.timing.fps
		let text = fps == fps.rounded() ? "\(Int(fps)) fps" : String(format: "%.2f fps", fps)
		return workspace.info.variableFrameRate ? text + " · variable" : text
	}

	private var fpsHelp: String {
		switch workspace.info.frameRateSource {
		case .container: workspace.info.variableFrameRate
			? "Read from the file. Frames aren't evenly spaced; stepping follows the real frames."
			: "Read from the file."
		default: "Estimated from the video track."
		}
	}
}

struct VolumeControl: View {
	var player: VideoPlayer
	@State private var hovering = false

	var body: some View {
		@Bindable var player = player
		HStack(spacing: 6) {
			if hovering {
				Slider(value: Binding(get: { Double(player.volume) }, set: { player.volume = Float($0); player.isMuted = false }), in: 0...1)
					.frame(width: 80)
					.controlSize(.mini)
			}
			Button {
				player.isMuted.toggle()
			} label: {
				Image(systemName: player.isMuted || player.volume == 0 ? "speaker.slash.fill" : "speaker.wave.2.fill").frame(width: 20)
			}
			.buttonStyle(.plain)
			.help("Mute (Shift M)")
		}
		.onHover { hovering = $0 }
	}
}
