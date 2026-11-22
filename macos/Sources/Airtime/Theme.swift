import AirtimeKit
import SwiftUI

/// The web app's design tokens (`src/routes/layout.css`): neutral near-black surfaces one step
/// lighter per layer, with hue kept for status only.
enum Theme {
	static func gray(_ lightness: Double, _ opacity: Double = 1) -> Color { Color(white: lightness).opacity(opacity) }

	static let bg = gray(0.04)
	static let elevated = gray(0.065)
	static let surface = gray(0.095)
	static let surfaceHover = gray(0.13)
	static let stage = gray(0.025)
	static let fg = gray(0.95)
	static let fgSecondary = gray(0.74)
	static let fgMuted = gray(0.60)
	static let border = gray(0.13)
	static let borderHover = gray(0.19)
	static let emphasis = gray(0.88)
	static let takeoff = gray(0.94)
	static let landing = gray(0.66)
	static let success = Color(hue: 160 / 360, saturation: 0.84, brightness: 0.75)
	static let warning = Color(hue: 38 / 360, saturation: 0.92, brightness: 0.95)
	static let error = Color(hue: 0, saturation: 0.62, brightness: 0.88)

	static let mono = Font.system(.body, design: .monospaced)
	static func number(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
		.system(size: size, weight: weight).monospacedDigit()
	}
}

extension View {
	/// A card: one step up from the page, hairline border, 12 px corners.
	func card(padding: CGFloat = 0) -> some View {
		self.padding(padding)
			.background(Theme.surface.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
			.overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border))
	}
}

/// Quiet rounded button, as the web app's secondary controls.
struct QuietButtonStyle: ButtonStyle {
	var prominent = false
	var destructive = false
	@Environment(\.isEnabled) private var enabled

	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.font(.system(size: 13, weight: .medium))
			.foregroundStyle(destructive ? Theme.error : prominent ? Color.black : Theme.fg)
			.padding(.horizontal, 12)
			.frame(height: 30)
			.background(
				RoundedRectangle(cornerRadius: 8).fill(
					prominent ? Theme.emphasis.opacity(configuration.isPressed ? 0.8 : 1)
						: destructive ? Theme.error.opacity(configuration.isPressed ? 0.2 : 0.1)
						: Theme.fg.opacity(configuration.isPressed ? 0.12 : 0.06)))
			.opacity(enabled ? 1 : 0.4)
			.contentShape(Rectangle())
	}
}

/// What a mark's type looks like without colour (`MarkGlyph.svelte`): a takeoff is the flight
/// arc leaving the ground, a landing the arc coming down onto it.
struct MarkGlyph: View {
	var type: MarkType
	var size: CGFloat = 16

	var body: some View {
		Canvas { context, canvas in
			let s = canvas.width / 16
			var ground = Path()
			ground.move(to: CGPoint(x: 1.5 * s, y: 14 * s))
			ground.addLine(to: CGPoint(x: 14.5 * s, y: 14 * s))
			var arc = Path()
			if type == .takeoff {
				arc.move(to: CGPoint(x: 3.5 * s, y: 11.5 * s))
				arc.addCurve(to: CGPoint(x: 13 * s, y: 3 * s), control1: CGPoint(x: 4.5 * s, y: 6.5 * s), control2: CGPoint(x: 8 * s, y: 3.5 * s))
				arc.move(to: CGPoint(x: 10.2 * s, y: 1.6 * s))
				arc.addLine(to: CGPoint(x: 13 * s, y: 3 * s))
				arc.addLine(to: CGPoint(x: 11.3 * s, y: 5.7 * s))
			} else {
				arc.move(to: CGPoint(x: 3 * s, y: 3 * s))
				arc.addCurve(to: CGPoint(x: 12.5 * s, y: 11.5 * s), control1: CGPoint(x: 8 * s, y: 3.5 * s), control2: CGPoint(x: 11.5 * s, y: 6.5 * s))
				arc.move(to: CGPoint(x: 10 * s, y: 9.6 * s))
				arc.addLine(to: CGPoint(x: 12.5 * s, y: 11.5 * s))
				arc.addLine(to: CGPoint(x: 14.1 * s, y: 8.9 * s))
			}
			let style = StrokeStyle(lineWidth: 1.7 * s, lineCap: .round, lineJoin: .round)
			context.stroke(ground, with: .foreground, style: style)
			context.stroke(arc, with: .foreground, style: style)
		}
		.frame(width: size, height: size)
		.accessibilityHidden(true)
	}
}

/// Where a step sits in a jump (`MarkArc.svelte`): ground contact from plant step to takeoff,
/// then the flight arc down to the landing. The step in question is a solid dot.
struct MarkArc: View {
	var step: MarkStep

	var body: some View {
		Canvas { context, _ in
			let points: [MarkStep: CGFloat] = [.plant: 3, .takeoff: 15, .landing: 33]
			var lines = context
			for (at, x) in points {
				let r: CGFloat = at == step ? 4.25 : 3.5
				lines.clip(to: Path(CGRect(x: -2, y: -4, width: 40, height: 22)).subtracting(Path(ellipseIn: CGRect(x: x - r, y: 12 - r, width: 2 * r, height: 2 * r))))
			}
			var ground = Path()
			ground.move(to: CGPoint(x: 3, y: 12))
			ground.addLine(to: CGPoint(x: 15, y: 12))
			var flight = Path()
			flight.move(to: CGPoint(x: 15, y: 12))
			flight.addQuadCurve(to: CGPoint(x: 33, y: 12), control: CGPoint(x: 24, y: -5))
			let style = StrokeStyle(lineWidth: 1.5, lineCap: .round)
			lines.opacity = 0.45
			lines.stroke(ground, with: .foreground, style: style)
			lines.opacity = 0.6
			lines.stroke(flight, with: .foreground, style: style)
			for (at, x) in points {
				if at == step {
					context.fill(Path(ellipseIn: CGRect(x: x - 3, y: 9, width: 6, height: 6)), with: .foreground)
				} else {
					var ring = context
					ring.opacity = 0.6
					ring.stroke(Path(ellipseIn: CGRect(x: x - 2.25, y: 9.75, width: 4.5, height: 4.5)), with: .foreground, lineWidth: 1.5)
				}
			}
		}
		.frame(width: 36, height: 16)
		.accessibilityHidden(true)
	}
}

/// The app's takeoff mark, for the header.
struct AppMark: View {
	var body: some View {
		ZStack {
			RoundedRectangle(cornerRadius: 6).fill(LinearGradient(colors: [Theme.gray(0.11), Theme.gray(0.04)], startPoint: .top, endPoint: .bottom))
			MarkGlyph(type: .takeoff, size: 14).foregroundStyle(Theme.fg)
		}
		.frame(width: 24, height: 24)
		.overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Theme.border))
	}
}

func ms(_ seconds: Double) -> String { String(Int((seconds * 1000).rounded())) }

/// "482 ms" with a quieter unit, as the web app sets values.
struct Measure: View {
	var value: String
	var size: CGFloat
	var unit = "ms"
	var weight: Font.Weight = .semibold
	var color = Theme.fg

	var body: some View {
		HStack(alignment: .firstTextBaseline, spacing: size * 0.08) {
			Text(value).font(Theme.number(size, weight: weight)).foregroundStyle(color)
			Text(unit).font(.system(size: max(11, size * 0.36), weight: .regular)).foregroundStyle(Theme.fgMuted)
		}
	}
}

extension Date {
	var mediumDate: String { formatted(.dateTime.month(.abbreviated).day().year()) }
	var dateTime: String { formatted(.dateTime.month(.abbreviated).day().year().hour().minute()) }
}

func isoDate(_ iso: String) -> Date? { ISODate.date(iso) }
