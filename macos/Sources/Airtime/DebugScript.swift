import AVFoundation
import AirtimeKit
import AppKit
import SwiftUI

/// Drives the app from a script and renders its window to PNGs, for checking the UI without a
/// screen recording permission or taking focus: `AIRTIME_SCRIPT=steps.txt open -g Airtime.app`.
///
/// One step per line: `open <video>`, `import <export.json>`, `key <characters>`, `keycode <n>`,
/// `wait <ms>`, `snap <file.png>`, `screen home|player|results`, `sessions list|trends`,
/// `keybinds`, `dismiss`, `save`, `frame <n>`, `size <w>x<h>`, `log <text>`, `quit`.
@MainActor
enum DebugScript {
	static func runIfRequested(app: AppModel) {
		guard let path = ProcessInfo.processInfo.environment["AIRTIME_SCRIPT"],
			let text = try? String(contentsOfFile: path, encoding: .utf8)
		else { return }
		Task {
			try? await Task.sleep(for: .milliseconds(600))
			for line in text.split(separator: "\n").map(String.init) {
				let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
				guard let command = parts.first, !command.hasPrefix("#") else { continue }
				let argument = parts.count > 1 ? parts[1] : ""
				await run(command, argument, app: app)
			}
		}
	}

	private static func run(_ command: String, _ argument: String, app: AppModel) async {
		switch command {
		case "open": await app.open(URL(fileURLWithPath: argument))
		case "import":
			_ = try? app.store.importBackup(Data(contentsOf: URL(fileURLWithPath: argument)))
			app.reload()
		case "key":
			for character in argument { send(String(character), keyCode: 0, app: app) }
		case "keycode": send("", keyCode: UInt16(argument) ?? 0, app: app)
		case "wait": try? await Task.sleep(for: .milliseconds(Int(argument) ?? 100))
		case "snap": await snap(to: argument, app: app)
		case "screen":
			switch argument {
			case "results": app.screen = .results
			case "player": app.screen = .player
			default: app.goHome()
			}
		case "open-session":
			if let session = app.sessions.first(where: { $0.title == argument }) {
				let fingerprint = session.media.fingerprint, size = session.media.sizeBytes, store = app.store
				if let url = await Task.detached(operation: { store.locateVideo(fingerprint: fingerprint, sizeBytes: size) }).value {
					await app.open(url, expected: session)
				} else {
					app.screen = .savedResults(session.id)
				}
			}
		case "add-folder": app.store.updateLibrary { $0.folders.append(argument) }
		case "saved-results": if let first = app.sessions.first { app.screen = .savedResults(first.id) }
		case "sessions":
			app.sessionsTab = argument == "trends" ? .trends : .list
			app.showSessions = true
		case "keybinds": app.showKeybinds = true
		case "dismiss":
			app.showSessions = false
			app.showKeybinds = false
		case "save": app.save()
		case "frame": await app.workspace?.player.seek(toFrame: Int(argument) ?? 0)
		case "size":
			let dims = argument.split(separator: "x").compactMap { Double($0) }
			if dims.count == 2, let window = mainWindow {
				window.setContentSize(NSSize(width: dims[0], height: dims[1]))
			}
		case "log": print("[script]", argument, state(app))
		case "quit": NSApp.terminate(nil)
		default: print("[script] unknown step:", command)
		}
	}

	private static func state(_ app: AppModel) -> String {
		guard let w = app.workspace else { return "screen=\(app.screen) sessions=\(app.sessions.count)" }
		return "screen=\(app.screen) frame=\(w.player.frame) presented=\(w.player.presentedFrame) marks=\(w.marks.count) dirty=\(w.isDirty) saved=\(w.isSaved) jumps=\(w.units.count) sessions=\(app.sessions.count) markFrames=\(sortMarks(w.marks).map { w.timing.frame(ofMarkTime: $0.time) })"
	}

	private static func send(_ characters: String, keyCode: UInt16, app: AppModel) {
		guard let window = mainWindow,
			let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: characters == characters.uppercased() && characters != characters.lowercased() ? .shift : [],
				timestamp: 0, windowNumber: window.windowNumber, context: nil, characters: characters,
				charactersIgnoringModifiers: characters, isARepeat: false, keyCode: keyCode)
		else { return }
		_ = Keys.handle(event, app: app)
	}

	private static var mainWindow: NSWindow? {
		NSApp.windows.first { $0.identifier?.rawValue == "main" || $0.title == "Airtime" || $0.contentView is NSHostingView<AnyView> } ?? NSApp.windows.first { $0.isVisible && $0.sheetParent == nil }
	}

	/// The window as AppKit draws it, with the decoded video frame painted where AVPlayerLayer
	/// shows it (the compositor draws that layer, so the window's own drawing leaves it empty),
	/// and any sheet on top.
	private static func snap(to path: String, app: AppModel) async {
		try? await Task.sleep(for: .milliseconds(150))
		guard let window = mainWindow, let content = window.contentView?.superview ?? window.contentView else { return }
		let bounds = content.bounds
		guard let rep = content.bitmapImageRepForCachingDisplay(in: bounds) else { return }
		content.cacheDisplay(in: bounds, to: rep)
		let image = NSImage(size: bounds.size)
		image.addRepresentation(rep)
		let composite = NSImage(size: bounds.size)
		composite.lockFocus()
		image.draw(in: CGRect(origin: .zero, size: bounds.size))
		if let surface = find(SurfaceView.self, in: content), let workspace = app.workspace, app.screen == .player,
			let frame = await currentFrame(workspace)
		{
			let video = surface.convert(surface.playerLayer.videoRect, to: content)
			let flipped = content.isFlipped ? CGRect(x: video.minX, y: bounds.height - video.maxY, width: video.width, height: video.height) : video
			NSGraphicsContext.current?.cgContext.draw(frame, in: flipped)
		}
		for sheet in window.sheets {
			guard let view = sheet.contentView?.superview ?? sheet.contentView, let sheetRep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { continue }
			view.cacheDisplay(in: view.bounds, to: sheetRep)
			NSColor.black.withAlphaComponent(0.45).setFill()
			CGRect(origin: .zero, size: bounds.size).fill()
			let origin = CGPoint(x: (bounds.width - view.bounds.width) / 2, y: bounds.height - view.bounds.height - 28)
			sheetRep.draw(in: CGRect(origin: origin, size: view.bounds.size))
		}
		composite.unlockFocus()
		guard let tiff = composite.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { return }
		try? png.write(to: URL(fileURLWithPath: path))
		print("[script] snap", path, state(app))
	}

	private static func currentFrame(_ workspace: Workspace) async -> CGImage? {
		let generator = AVAssetImageGenerator(asset: AVURLAsset(url: workspace.info.url))
		generator.appliesPreferredTrackTransform = true
		generator.requestedTimeToleranceBefore = .zero
		generator.requestedTimeToleranceAfter = .zero
		return try? await generator.image(at: workspace.player.player.currentTime()).image
	}

	private static func find<T: NSView>(_ type: T.Type, in view: NSView) -> T? {
		if let match = view as? T { return match }
		for child in view.subviews { if let match = find(type, in: child) { return match } }
		return nil
	}
}
