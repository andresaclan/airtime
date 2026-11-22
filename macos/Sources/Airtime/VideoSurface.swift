import AVFoundation
import AirtimePlayer
import AppKit
import SwiftUI

/// The picture: AVPlayerLayer, with the scrub preview over it while a far seek decodes. Zooms to
/// 5× with a pinch, ⌘-scroll or a double click, and pans by dragging once zoomed.
struct VideoSurface: NSViewRepresentable {
	var player: VideoPlayer
	@Binding var zoom: CGFloat

	func makeNSView(context: Context) -> SurfaceView {
		let view = SurfaceView()
		view.playerLayer.player = player.player
		view.onZoom = { zoom = $0 }
		return view
	}

	func updateNSView(_ view: SurfaceView, context: Context) {
		if view.playerLayer.player !== player.player { view.playerLayer.player = player.player }
		view.onZoom = { zoom = $0 }
		view.setPreview(player.preview)
		if abs(view.zoom - zoom) > 0.001 { view.setZoom(zoom, around: nil) }
	}
}

final class SurfaceView: NSView {
	let playerLayer = AVPlayerLayer()
	private let previewLayer = CALayer()
	private let content = CALayer()
	private(set) var zoom: CGFloat = 1
	private var pan = CGPoint.zero
	private var dragStart: (point: CGPoint, pan: CGPoint)?
	var onZoom: (CGFloat) -> Void = { _ in }

	static let maxZoom: CGFloat = 5

	override init(frame: NSRect) {
		super.init(frame: frame)
		wantsLayer = true
		layer?.backgroundColor = NSColor(white: 0.025, alpha: 1).cgColor
		layer?.masksToBounds = true
		playerLayer.videoGravity = .resizeAspect
		previewLayer.contentsGravity = .resizeAspect
		previewLayer.isHidden = true
		previewLayer.magnificationFilter = .linear
		content.addSublayer(playerLayer)
		content.addSublayer(previewLayer)
		layer?.addSublayer(content)
		// No implicit animations: zoom, pan and previews follow input exactly.
		let none: [String: CAAction] = ["position": NSNull(), "bounds": NSNull(), "transform": NSNull(), "contents": NSNull(), "hidden": NSNull(), "sublayerTransform": NSNull()]
		for l in [playerLayer, previewLayer, content] { l.actions = none }
	}

	required init?(coder: NSCoder) { fatalError() }

	override func layout() {
		super.layout()
		CATransaction.begin()
		CATransaction.setDisableActions(true)
		content.frame = bounds
		playerLayer.frame = content.bounds
		previewLayer.frame = playerLayer.videoRect.isEmpty ? content.bounds : playerLayer.videoRect
		applyTransform()
		CATransaction.commit()
	}

	func setPreview(_ image: CGImage?) {
		CATransaction.begin()
		CATransaction.setDisableActions(true)
		previewLayer.contents = image
		previewLayer.isHidden = image == nil
		if !playerLayer.videoRect.isEmpty { previewLayer.frame = playerLayer.videoRect }
		CATransaction.commit()
	}

	func setZoom(_ value: CGFloat, around point: CGPoint?) {
		let next = min(Self.maxZoom, max(1, value))
		if let point {
			// Keep the content under the pointer where it is.
			let center = CGPoint(x: bounds.midX, y: bounds.midY)
			let offset = CGPoint(x: point.x - center.x - pan.x, y: point.y - center.y - pan.y)
			pan.x -= offset.x * (next / zoom - 1)
			pan.y -= offset.y * (next / zoom - 1)
		}
		zoom = next
		if zoom == 1 { pan = .zero }
		clampPan()
		applyTransform()
	}

	private func clampPan() {
		let limitX = bounds.width * (zoom - 1) / 2
		let limitY = bounds.height * (zoom - 1) / 2
		pan.x = min(limitX, max(-limitX, pan.x))
		pan.y = min(limitY, max(-limitY, pan.y))
	}

	private func applyTransform() {
		CATransaction.begin()
		CATransaction.setDisableActions(true)
		content.setAffineTransform(CGAffineTransform(translationX: pan.x, y: pan.y).scaledBy(x: zoom, y: zoom))
		CATransaction.commit()
	}

	private func report() { onZoom(zoom) }

	override func magnify(with event: NSEvent) {
		setZoom(zoom * (1 + event.magnification), around: convert(event.locationInWindow, from: nil))
		report()
	}

	override func scrollWheel(with event: NSEvent) {
		if event.modifierFlags.contains(.command) {
			setZoom(zoom * exp(event.scrollingDeltaY * 0.01), around: convert(event.locationInWindow, from: nil))
			report()
		} else if zoom > 1 {
			pan.x += event.scrollingDeltaX
			pan.y -= event.scrollingDeltaY
			clampPan()
			applyTransform()
		} else {
			super.scrollWheel(with: event)
		}
	}

	override func mouseDown(with event: NSEvent) {
		if event.clickCount == 2 {
			setZoom(zoom > 1 ? 1 : 2, around: convert(event.locationInWindow, from: nil))
			report()
			return
		}
		dragStart = (convert(event.locationInWindow, from: nil), pan)
	}

	override func mouseDragged(with event: NSEvent) {
		guard zoom > 1, let start = dragStart else { return }
		let point = convert(event.locationInWindow, from: nil)
		pan = CGPoint(x: start.pan.x + point.x - start.point.x, y: start.pan.y + point.y - start.point.y)
		clampPan()
		applyTransform()
	}

	override func mouseUp(with event: NSEvent) { dragStart = nil }

	override func resetCursorRects() {
		if zoom > 1 { addCursorRect(bounds, cursor: .openHand) }
	}

	override var acceptsFirstResponder: Bool { false }
}
