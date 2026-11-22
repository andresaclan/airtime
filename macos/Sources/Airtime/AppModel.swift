import AirtimeKit
import AirtimePlayer
import AppKit
import Foundation
import Observation
import UniformTypeIdentifiers

enum Screen: Equatable {
	case home
	case player
	/// Results of the open video's session.
	case results
	/// Results of a saved session whose video isn't open.
	case savedResults(String)
}

/// Navigation, saved sessions and the open video.
@MainActor @Observable
final class AppModel {
	let store: Store
	var screen: Screen = .home
	private(set) var workspace: Workspace?
	private(set) var sessions: [Session] = []
	private(set) var drafts: [Draft] = []
	private(set) var unreadable = 0
	var showSessions = false
	var sessionsTab: SessionsTab = .list
	var showKeybinds = false
	var notice: String?
	/// A video being opened (fingerprinting, reading its frame table).
	private(set) var opening: String?
	var problem: String?
	@ObservationIgnored private var noticeTask: Task<Void, Never>?
	/// The latest open request; an older one that finishes later does nothing.
	@ObservationIgnored private var request = 0

	private func beginRequest() -> Int {
		request += 1
		return request
	}

	enum SessionsTab: Hashable { case list, trends }

	init(store: Store = Store()) {
		self.store = store
		reload()
	}

	func reload() {
		let read = store.readSessions()
		sessions = read.sessions
		unreadable = read.unreadable.count
		// The open video's own draft too: Home is where it's resumed from.
		drafts = store.drafts().filter(\.holdsWork)
	}

	func show(_ text: String) {
		notice = text
		noticeTask?.cancel()
		noticeTask = Task {
			try? await Task.sleep(for: .seconds(3.5))
			if !Task.isCancelled { notice = nil }
		}
	}

	func session(id: String) -> Session? { sessions.first { $0.id == id } }

	// MARK: Opening videos

	func chooseVideo() {
		let panel = NSOpenPanel()
		panel.allowedContentTypes = [.movie, .video, .quickTimeMovie, .mpeg4Movie]
		panel.message = "Choose a jump video"
		guard panel.runModal() == .OK, let url = panel.url else { return }
		Task { await open(url) }
	}

	/// Opens a video, bringing back its saved session or unsaved draft. With `expected`, only
	/// that session's video is accepted.
	func open(_ url: URL, expected: Session? = nil, atMark: Double? = nil) async {
		let id = beginRequest()
		problem = nil
		opening = url.lastPathComponent
		defer { if id == request { opening = nil } }
		let fingerprint: String
		do {
			fingerprint = try await Task.detached { try fingerprintFile(url) }.value
		} catch {
			if id == request { problem = "\(url.lastPathComponent) could not be read." }
			return
		}
		guard id == request else { return }
		if let expected, expected.media.fingerprint != fingerprint {
			problem = "That's a different video. Choose the original file: \(expected.media.fileName)"
			return
		}
		// The open video stays until the new one has proven it plays.
		let player = VideoPlayer()
		let info: VideoInfo
		do {
			info = try await player.open(url)
		} catch {
			if id == request { problem = error.localizedDescription }
			return
		}
		guard id == request else {
			player.close()
			return
		}
		// Always flushed, clean or not: a clean workspace's flush deletes a draft it made obsolete.
		if let current = workspace, !current.flushDraft(), current.isDirty {
			player.close()
			problem = "Your unsaved marks on \(current.info.url.lastPathComponent) couldn't be written to disk. Save them before opening another video."
			return
		}
		workspace?.player.close()
		let workspace = Workspace(store: store, player: player, info: info, fingerprint: fingerprint)
		// The session asked for, as stored now; otherwise the one saved for this video.
		let saved = expected.flatMap { e in store.readSessions().sessions.first { $0.id == e.id } } ?? store.session(fingerprint: fingerprint)
		// A draft only belongs to that session if it's new work or edits to the same one.
		let draft = store.draft(fingerprint: fingerprint).flatMap { $0.isNew || saved == nil || $0.session.id == saved?.id ? $0 : nil }
		let pick = pickRestore(saved: saved, draft: draft)
		if pick.staleDraft { store.setDraft(nil, fingerprint: fingerprint) }
		workspace.restore(pick.restore)
		store.remember(url, fingerprint: fingerprint, sizeBytes: info.fileSize)
		self.workspace = workspace
		screen = .player
		reload()
		if case .draft = pick.restore { show("Unsaved changes restored") }
		if let atMark { await workspace.player.seek(toFrame: info.timing.frame(ofMarkTime: atMark)) }
	}

	/// Opens a saved session's video wherever it is now, asking only when it can't be found.
	/// Whether the open workspace already is this saved session. An unsaved workspace on the
	/// same video isn't: opening the session brings its saved marks in.
	private func holds(_ workspace: Workspace, _ session: Session) -> Bool {
		workspace.fingerprint == session.media.fingerprint && workspace.saved?.id == session.id
	}

	func openVideo(for session: Session, atMark: Double? = nil) async {
		if let workspace, holds(workspace, session) {
			screen = .player
			if let atMark { await workspace.player.seek(toFrame: workspace.timing.frame(ofMarkTime: atMark)) }
			return
		}
		let id = beginRequest()
		opening = session.media.fileName
		let fingerprint = session.media.fingerprint
		let size = session.media.sizeBytes
		let store = self.store
		let found = await Task.detached { store.locateVideo(fingerprint: fingerprint, sizeBytes: size) }.value
		guard id == request else { return }
		opening = nil
		if let found {
			await open(found, expected: session, atMark: atMark)
		} else {
			await locate(session, atMark: atMark)
		}
	}

	/// Asks where a session's video is, starting in the folder it was last seen in.
	func locate(_ session: Session, atMark: Double? = nil) async {
		let panel = NSOpenPanel()
		panel.allowedContentTypes = [.movie, .video, .quickTimeMovie, .mpeg4Movie]
		panel.message = "Where is \(session.media.fileName)? Airtime will remember it."
		panel.prompt = "Open"
		if let last = store.library().locations[session.media.fingerprint] {
			panel.directoryURL = URL(fileURLWithPath: last.path).deletingLastPathComponent()
		}
		guard panel.runModal() == .OK, let url = panel.url else { return }
		await open(url, expected: session, atMark: atMark)
	}

	func openSession(_ session: Session) {
		if let workspace, holds(workspace, session) {
			screen = .player
			return
		}
		Task {
			let id = beginRequest()
			let fingerprint = session.media.fingerprint
			let size = session.media.sizeBytes
			let store = self.store
			opening = session.media.fileName
			let found = await Task.detached { store.locateVideo(fingerprint: fingerprint, sizeBytes: size) }.value
			guard id == request else { return }
			opening = nil
			if let found { await open(found, expected: session) } else { screen = .savedResults(session.id) }
		}
	}

	/// A session's results. The open video's session is edited through its workspace, so its
	/// saved copy and the edits on screen never diverge.
	func showResults(_ session: Session) {
		if let workspace, workspace.saved?.id == session.id { screen = .results } else { screen = .savedResults(session.id) }
	}

	func resume(_ draft: Draft) {
		let session = draft.session
		Task { await openVideo(for: session) }
	}

	func discard(_ draft: Draft) {
		if let workspace, workspace.fingerprint == draft.fingerprint { workspace.revert() }
		store.setDraft(nil, fingerprint: draft.fingerprint)
		reload()
	}

	func goHome() {
		workspace?.player.pause()
		workspace?.flushDraft()
		screen = .home
		reload()
	}

	func closeVideo() {
		if let current = workspace, !current.flushDraft(), current.isDirty {
			problem = "Your unsaved marks couldn't be written to disk. Save them before closing the video."
			return
		}
		workspace?.player.close()
		workspace = nil
		screen = .home
		reload()
	}

	// MARK: Saving

	func save() {
		guard let workspace, workspace.isDirty || !workspace.isSaved else { return }
		do {
			try workspace.save()
			reload()
			show("Saved")
		} catch {
			show("Couldn't save: \(error.localizedDescription)")
		}
	}

	/// Edits to a saved session whose video isn't open save straight away.
	func update(_ session: Session) {
		var session = session
		session.updatedAt = ISODate.now()
		try? store.put(session)
		reload()
	}

	func delete(_ session: Session) {
		store.delete(sessionId: session.id)
		if let workspace, workspace.saved?.id == session.id { workspace.forgetSaved() }
		if screen == .savedResults(session.id) { screen = .home }
		reload()
		show("Deleted \(session.title)")
	}

	// MARK: Backups

	func importBackup() {
		let panel = NSOpenPanel()
		panel.allowedContentTypes = [.json]
		panel.message = "Choose an Airtime export, from this app or the web app"
		guard panel.runModal() == .OK, let url = panel.url else { return }
		do {
			let result = try store.importBackup(try Data(contentsOf: url))
			reload()
			show("Imported \(result.imported) session\(result.imported == 1 ? "" : "s")" + (result.skipped > 0 ? " · skipped \(result.skipped) already up to date" : ""))
		} catch {
			show("Import failed: \(error.localizedDescription)")
		}
	}

	func export(_ sessions: [Session]) {
		guard !sessions.isEmpty else { return }
		let panel = NSSavePanel()
		panel.allowedContentTypes = [.json]
		panel.nameFieldStringValue = exportFileName(sessions)
		guard panel.runModal() == .OK, let url = panel.url else { return }
		do {
			try buildExport(sessions).write(to: url, options: .atomic)
			show("Exported \(sessions.count) session\(sessions.count == 1 ? "" : "s")")
		} catch {
			show("Export failed: \(error.localizedDescription)")
		}
	}

	// MARK: Video folders

	var videoFolders: [URL] { store.library().folders.map { URL(fileURLWithPath: $0) } }

	func addVideoFolder() {
		let panel = NSOpenPanel()
		panel.canChooseDirectories = true
		panel.canChooseFiles = false
		panel.allowsMultipleSelection = true
		panel.message = "Airtime looks in these folders for a session's video when it has moved."
		guard panel.runModal() == .OK else { return }
		store.updateLibrary { library in
			for url in panel.urls where !library.folders.contains(url.path) { library.folders.append(url.path) }
		}
	}

	func removeVideoFolder(_ url: URL) {
		store.updateLibrary { $0.folders.removeAll { $0 == url.path } }
	}
}
