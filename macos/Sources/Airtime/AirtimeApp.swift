import AirtimeKit
import AppKit
import SwiftUI
import UniformTypeIdentifiers

@main
struct AirtimeApp: App {
	@NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
	@State private var app = AppModel()

	var body: some Scene {
		Window("Airtime", id: "main") {
			RootView()
				.environment(app)
				.preferredColorScheme(.dark)
				.frame(minWidth: 980, minHeight: 640)
				.onAppear {
					delegate.app = app
					DebugScript.runIfRequested(app: app)
				}
		}
		.windowStyle(.hiddenTitleBar)
		.defaultSize(width: 1360, height: 860)
		.commands {
			CommandGroup(replacing: .newItem) {
				Button("Open Video…") { app.chooseVideo() }.keyboardShortcut("o")
				Button("Close Video") { app.closeVideo() }.keyboardShortcut("w", modifiers: [.command, .shift]).disabled(app.workspace == nil)
			}
			CommandGroup(replacing: .saveItem) {
				Button("Save Session") { app.save() }.keyboardShortcut("s").disabled(app.workspace == nil)
			}
			CommandGroup(replacing: .importExport) {
				Button("Import Backup…") { app.importBackup() }
				Button("Export All Sessions…") { app.export(app.sessions) }.disabled(app.sessions.isEmpty)
			}
			CommandMenu("Session") {
				Button("Saved Sessions") {
					app.sessionsTab = .list
					app.showSessions = true
				}
				.keyboardShortcut("e")
				Button("Trends") {
					app.sessionsTab = .trends
					app.showSessions = true
				}
				Divider()
				Button(app.screen == .results ? "Back to Video" : "Results") {
					app.screen = app.screen == .results ? .player : .results
				}
				.disabled(app.workspace == nil)
				Button("Home") { app.goHome() }.keyboardShortcut("h", modifiers: [.command, .shift])
			}
			CommandGroup(replacing: .help) {
				Button("Keyboard Shortcuts") { app.showKeybinds = true }.keyboardShortcut("/", modifiers: [.command])
			}
		}
		Settings {
			SettingsView().environment(app).preferredColorScheme(.dark)
		}
	}
}

final class AppDelegate: NSObject, NSApplicationDelegate {
	weak var app: AppModel?
	private var monitor: Any?

	func applicationDidFinishLaunching(_ notification: Notification) {
		NSApp.appearance = NSAppearance(named: .darkAqua)
		monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
			MainActor.assumeIsolated {
				guard let app = self?.app else { return event }
				return Keys.handle(event, app: app) ? nil : event
			}
		}
		// `swift run` launches a bare executable; make it a regular app with a Dock icon.
		NSApp.setActivationPolicy(.regular)
		if let icon = Bundle.main.image(forResource: "AppIcon") { NSApp.applicationIconImage = icon }
		let arguments = CommandLine.arguments.dropFirst().filter { !$0.hasPrefix("-") }
		if let path = arguments.first {
			Task { @MainActor in
				while self.app == nil { try? await Task.sleep(for: .milliseconds(20)) }
				await self.app?.open(URL(fileURLWithPath: path))
			}
		}
	}

	func application(_ application: NSApplication, open urls: [URL]) {
		guard let url = urls.first else { return }
		Task { @MainActor in
			while self.app == nil { try? await Task.sleep(for: .milliseconds(20)) }
			await self.app?.open(url)
		}
	}

	/// Unsaved edits live in their draft. If it can't be written, say so before quitting.
	func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
		MainActor.assumeIsolated {
			guard let workspace = app?.workspace, workspace.isDirty, !workspace.flushDraft() else { return .terminateNow }
			let alert = NSAlert()
			alert.messageText = "Your unsaved marks couldn't be kept"
			alert.informativeText = "Airtime couldn't write them to disk. Save the session first, or quit and lose them."
			alert.addButton(withTitle: "Cancel")
			alert.addButton(withTitle: "Quit Anyway")
			return alert.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
		}
	}

	func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

/// Single-key shortcuts, as in the web app. They never fire while typing in a field.
@MainActor
enum Keys {
	static func handle(_ event: NSEvent, app: AppModel) -> Bool {
		if let responder = event.window?.firstResponder, responder is NSText || responder is NSTextView { return false }
		let flags = event.modifierFlags.intersection([.command, .control, .option])
		// ⌘Z undoes marks on the player; in a text field it stays the field's own undo.
		if flags == .command, event.charactersIgnoringModifiers?.lowercased() == "z", app.screen == .player,
			!app.showSessions, !app.showKeybinds, let workspace = app.workspace
		{
			if event.modifierFlags.contains(.shift) { workspace.redo() } else { workspace.undo() }
			return true
		}
		guard flags.isEmpty else { return false }
		let key = event.charactersIgnoringModifiers ?? ""
		if key == "?" {
			app.showKeybinds.toggle()
			return true
		}
		if app.showSessions || app.showKeybinds { return false }
		guard let workspace = app.workspace else { return false }
		if app.screen == .results {
			if key.lowercased() == "a" {
				app.screen = .player
				return true
			}
			return false
		}
		guard app.screen == .player else { return false }
		let player = workspace.player
		let shift = event.modifierFlags.contains(.shift)
		switch event.keyCode {
		case 49: player.togglePlay(); return true  // space
		case 123: player.step(-1); return true  // ←
		case 124: player.step(1); return true  // →
		case 126: player.volume = min(1, player.volume + 0.1); player.isMuted = false; return true
		case 125: player.volume = max(0, player.volume - 0.1); return true
		case 115: Task { await player.seek(toFrame: 0) }; return true  // Home
		case 119: Task { await player.seek(toFrame: player.lastFrame) }; return true  // End
		case 51, 117:  // delete, forward delete
			if let mark = workspace.markOnFrame { workspace.remove(mark) }
			return true
		default: break
		}
		switch key.lowercased() {
		case "k": player.togglePlay()
		case ",", "<": player.step(-1)
		case ".", ">": player.step(1)
		case "r":
			let speeds: [Float] = [1, 0.5, 0.25]
			player.speed = speeds[((speeds.firstIndex(of: player.speed) ?? 0) + 1) % speeds.count]
		case "m":
			if shift {
				player.isMuted.toggle()
			} else {
				workspace.pressMark { NotificationCenter.default.post(name: .airtimeEditMark, object: nil) }
			}
		case "t": workspace.place(.takeoff)
		case "l": workspace.place(.landing)
		case "[": workspace.seekAdjacentMark(-1)
		case "]": workspace.seekAdjacentMark(1)
		case "a":
			player.pause()
			app.screen = .results
		default: return false
		}
		return true
	}
}

struct RootView: View {
	@Environment(AppModel.self) private var app
	@State private var dropping = false

	var body: some View {
		@Bindable var app = app
		VStack(spacing: 0) {
		Header()
		ZStack(alignment: .bottom) {
			Group {
				switch app.screen {
				case .home: HomeView()
				case .player:
					if let workspace = app.workspace { PlayerScreen(workspace: workspace) } else { HomeView() }
				case .results: ResultsView(workspace: app.workspace)
				case .savedResults(let id): ResultsView(workspace: nil, sessionId: id)
				}
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			if let notice = app.notice {
				Text(notice).font(.system(size: 13, weight: .medium))
					.padding(.horizontal, 14).padding(.vertical, 8)
					.background(Capsule().fill(Theme.surface)).overlay(Capsule().strokeBorder(Theme.borderHover))
					.padding(.bottom, 56)
					.transition(.opacity.combined(with: .move(edge: .bottom)))
			}
			if let problem = app.problem {
				HStack(spacing: 10) {
					Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.warning)
					Text(problem).font(.system(size: 13))
					Button("Choose another video") { app.chooseVideo() }.buttonStyle(QuietButtonStyle())
					Button {
						app.problem = nil
					} label: {
						Image(systemName: "xmark")
					}
					.buttonStyle(.plain)
				}
				.padding(12)
				.background(RoundedRectangle(cornerRadius: 10).fill(Theme.surface)).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.borderHover))
				.padding(.bottom, 20)
			}
			if app.opening != nil && app.screen != .home {
				HStack(spacing: 8) {
					ProgressView().controlSize(.small)
					Text("Opening \(app.opening ?? "")…").font(.system(size: 13))
				}
				.padding(12)
				.background(RoundedRectangle(cornerRadius: 10).fill(Theme.surface))
				.padding(.bottom, 20)
			}
		}
		.animation(.easeOut(duration: 0.2), value: app.notice)
		}
		.background(Theme.bg)
		.ignoresSafeArea(.container, edges: .top)
		.overlay {
			if dropping {
				RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.emphasis, style: StrokeStyle(lineWidth: 2, dash: [8, 6])).padding(10)
					.background(Theme.bg.opacity(0.5))
					.overlay(Text("Drop to open").font(.system(size: 15, weight: .medium)))
					.allowsHitTesting(false)
			}
		}
		.onDrop(of: [.fileURL], isTargeted: $dropping) { providers in
			guard let provider = providers.first else { return false }
			_ = provider.loadObject(ofClass: URL.self) { url, _ in
				guard let url else { return }
				Task { @MainActor in
					if videoExtensions.contains(url.pathExtension.lowercased()) || UTType(filenameExtension: url.pathExtension)?.conforms(to: .movie) == true {
						await app.open(url)
					} else {
						app.problem = "\(url.lastPathComponent) isn't a video Airtime can open."
					}
				}
			}
			return true
		}
		.navigationTitle(title)
		// An empty unified toolbar lowers the traffic lights to the middle of the header drawn
		// under it.
		.toolbar { ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1) } }
		.toolbarBackground(.hidden, for: .windowToolbar)
		.sheet(isPresented: $app.showSessions) { SessionsSheet().environment(app) }
		.sheet(isPresented: $app.showKeybinds) { KeybindsSheet() }
	}

	private var title: String { app.workspace?.info.url.lastPathComponent ?? "Airtime" }

}

/// The window's title bar, as the web app's header: home and the open file on the left, help,
/// sessions, open and save on the right. The traffic lights sit in its leading inset.
private struct Header: View {
	@Environment(AppModel.self) private var app

	var body: some View {
		HStack(spacing: 10) {
			Button {
				app.goHome()
			} label: {
				HStack(spacing: 9) {
					AppMark()
					Text("Airtime").font(.system(size: 14, weight: .semibold))
				}
			}
			.buttonStyle(.plain)
			.help("Home")
			if let workspace = app.workspace, app.screen != .home {
				Text("/").foregroundStyle(Theme.fgMuted)
				Button {
					app.screen = .player
				} label: {
					Text(workspace.info.url.lastPathComponent).font(.system(size: 13, weight: .medium)).lineLimit(1).truncationMode(.middle)
				}
				.buttonStyle(.plain)
				.help(workspace.info.url.path)
				SaveState(workspace: workspace).fixedSize()
			}
			Spacer(minLength: 12)
			Button {
				app.showKeybinds = true
			} label: {
				Image(systemName: "questionmark.circle").font(.system(size: 14))
			}
			.buttonStyle(HeaderButtonStyle())
			.help("Keyboard shortcuts (?)")
			Button {
				app.sessionsTab = .list
				app.showSessions = true
			} label: {
				Label("Sessions", systemImage: "list.bullet.rectangle")
			}
			.buttonStyle(HeaderButtonStyle())
			.help("Saved sessions (⌘E)")
			if let workspace = app.workspace, app.screen != .home {
				Divider().frame(height: 18)
				Button {
					app.chooseVideo()
				} label: {
					Label("Open video", systemImage: "folder")
				}
				.buttonStyle(HeaderButtonStyle())
				.help("Open another video (⌘O)")
				Button {
					app.save()
				} label: {
					HStack(spacing: 6) {
						Text("Save")
						Text("⌘S").font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.fgMuted)
					}
				}
				.buttonStyle(QuietButtonStyle())
				.overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.borderHover))
				.disabled(workspace.isSaved && !workspace.isDirty)
				.help("Save the session (⌘S)")
			}
		}
		.font(.system(size: 13))
		.padding(.leading, 84)
		.padding(.trailing, 14)
		.frame(height: 40)
		.padding(.top, 2)
		.background(Theme.bg)
		.overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 1) }
		.gesture(WindowDragGesture())
	}
}

private struct HeaderButtonStyle: ButtonStyle {
	@State private var hovering = false
	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.labelStyle(.titleAndIcon)
			.foregroundStyle(Theme.fg)
			.padding(.horizontal, 8)
			.frame(height: 28)
			.background(RoundedRectangle(cornerRadius: 7).fill(Theme.fg.opacity(configuration.isPressed ? 0.1 : hovering ? 0.06 : 0)))
			.onHover { hovering = $0 }
	}
}

private struct SaveState: View {
	var workspace: Workspace
	var body: some View {
		let saved = workspace.isSaved && !workspace.isDirty
		HStack(spacing: 5) {
			Circle().fill(saved ? Theme.success : Theme.fgSecondary).frame(width: 6, height: 6)
			Text(saved ? "Saved" : "Unsaved").font(.system(size: 12))
		}
		.foregroundStyle(Theme.fgSecondary)
		.padding(.horizontal, 8).padding(.vertical, 3)
		.background(Capsule().fill(Theme.fg.opacity(0.07)))
	}
}
