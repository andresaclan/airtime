import AirtimeKit
import AirtimePlayer
import Foundation
import Observation

/// One open video and the session being marked on it: marks with undo and redo, the session's
/// details, and whether they differ from what's saved. Unsaved work is written to a draft as it
/// changes, so quitting or opening another video never loses it.
@MainActor @Observable
final class Workspace {
	let player: VideoPlayer
	let store: Store
	private(set) var info: VideoInfo
	private(set) var fingerprint: String

	var marks: [Mark] = [] { didSet { changed() } }
	var title = "" { didSet { changed() } }
	var notes = "" { didSet { changed() } }
	var jumpType: JumpType? = defaultJumpType { didSet { changed() } }
	var timeScale = 1.0 { didSet { changed() } }
	var recordedAt = "" { didSet { changed() } }

	private(set) var history: [[Mark]] = []
	private(set) var future: [[Mark]] = []
	/// The saved session these edits are measured against; nil until first saved.
	private(set) var saved: Session?
	/// The id and creation time to save under when the saved file is gone but its draft came
	/// back: saving recreates the same session.
	private var recovered: (id: String, createdAt: String)?
	private(set) var createdAt: String
	/// What the session looked like when opened or last saved.
	private var baseline: Session.Signature
	@ObservationIgnored private var draftWrite: Task<Void, Never>?
	@ObservationIgnored private var restoring = false

	init(store: Store, player: VideoPlayer, info: VideoInfo, fingerprint: String) {
		self.store = store
		self.player = player
		self.info = info
		self.fingerprint = fingerprint
		createdAt = ISODate.now()
		baseline = Session.Signature(marks: [], title: "", notes: "", jumpType: nil, recordedAt: "", timeScale: 1)
		restoring = true
		title = defaultTitle(info.url.lastPathComponent)
		recordedAt = ISODate.string(info.creationDate ?? info.lastModified)
		restoring = false
		baseline = signature
	}

	var timing: Timing { info.timing }
	var media: SessionMedia {
		SessionMedia(
			fileName: info.url.lastPathComponent, mimeType: info.mimeType, sizeBytes: info.fileSize,
			lastModified: ISODate.string(info.lastModified), durationSeconds: info.duration,
			width: info.displaySize.width, height: info.displaySize.height, fingerprint: fingerprint)
	}

	var signature: Session.Signature {
		Session.Signature(marks: marks, title: title, notes: notes, jumpType: jumpType, recordedAt: recordedAt, timeScale: timeScale)
	}

	var isDirty: Bool { signature != baseline }
	var isSaved: Bool { saved != nil }

	/// The session as saving it now would write it.
	func session(now: String = ISODate.now()) -> Session {
		Session(
			id: saved?.id ?? recovered?.id ?? newId(), title: title, notes: notes, jumpType: jumpType,
			createdAt: saved?.createdAt ?? recovered?.createdAt ?? createdAt,
			updatedAt: now, recordedAt: recordedAt, media: media,
			frameRate: FrameRate(value: timing.fps, source: info.frameRateSource), timeScale: timeScale, marks: sortMarks(marks))
	}

	/// Brings back a saved session or a draft for this video.
	func restore(_ restore: Restore) {
		restoring = true
		defer { restoring = false }
		switch restore {
		case .none: return
		case .saved(let session):
			apply(session)
			saved = session
			baseline = signature
		case .draft(let draft, let savedSession):
			saved = savedSession
			if savedSession == nil, !draft.isNew { recovered = (draft.session.id, draft.session.createdAt) }
			if let savedSession {
				apply(savedSession)
				baseline = signature
			} else {
				// New work, or edits to a session deleted since: nothing saved matches them, so
				// they stay unsaved (saving a deleted session's draft writes it back, same id).
				baseline = Session.Signature(marks: [], title: "", notes: "", jumpType: nil, recordedAt: "", timeScale: 1)
			}
			apply(draft.session)
			createdAt = draft.session.createdAt
		}
	}

	private func apply(_ session: Session) {
		marks = sortMarks(session.marks)
		title = session.title
		notes = session.notes
		jumpType = session.jumpType
		timeScale = session.timeScale
		recordedAt = session.recordedAt
	}

	@discardableResult
	func save() throws -> Session {
		// One session per video: if one was saved for it meanwhile (an import while this was
		// open), these edits, the newest, replace it rather than adding a second.
		if saved == nil, recovered == nil, let existing = store.session(fingerprint: fingerprint) {
			recovered = (existing.id, existing.createdAt)
		}
		let session = session()
		try store.put(session)
		saved = session
		recovered = nil
		baseline = signature
		draftWrite?.cancel()
		store.setDraft(nil, fingerprint: fingerprint)
		return session
	}

	/// Throws away unsaved edits: back to the saved session, or to a fresh one.
	func revert() {
		restoring = true
		if let saved {
			apply(saved)
		} else {
			marks = []
			title = defaultTitle(info.url.lastPathComponent)
			notes = ""
			jumpType = defaultJumpType
			timeScale = 1
			recordedAt = ISODate.string(info.creationDate ?? info.lastModified)
		}
		history = []
		future = []
		recovered = nil
		restoring = false
		baseline = signature
		draftWrite?.cancel()
		store.setDraft(nil, fingerprint: fingerprint)
	}

	/// The saved session was deleted: the edits on screen become new, unsaved work.
	func forgetSaved() {
		saved = nil
		recovered = nil
		baseline = Session.Signature(marks: [], title: "", notes: "", jumpType: nil, recordedAt: "", timeScale: 1)
		changed()
	}

	private func changed() {
		guard !restoring else { return }
		draftWrite?.cancel()
		let fingerprint = self.fingerprint
		let dirty = isDirty
		let draft = dirty ? Draft(session: session(), isNew: saved == nil && recovered == nil, now: ISODate.now()) : nil
		draftWrite = Task { [store] in
			try? await Task.sleep(for: .milliseconds(250))
			guard !Task.isCancelled else { return }
			store.setDraft(draft, fingerprint: fingerprint)
		}
	}

	/// Writes a pending draft now (before quitting). False when it couldn't be written.
	@discardableResult
	func flushDraft() -> Bool {
		draftWrite?.cancel()
		return store.setDraft(isDirty ? Draft(session: session(), isNew: saved == nil && recovered == nil, now: ISODate.now()) : nil, fingerprint: fingerprint)
	}

	// MARK: Marks

	var analysis: Analysis { analyzeMarks(sortMarks(marks), timing: timing, timeScale: timeScale, jumpType: jumpType) }
	var units: [JumpUnit] { jumpUnits(sortMarks(marks), analysis) }

	func commit(_ next: [Mark]) {
		// Each newly measured jump counts towards retiring the marking hint.
		let flights = { (list: [Mark]) in
			analyzeMarks(sortMarks(list), timing: self.timing, timeScale: self.timeScale, jumpType: self.jumpType).intervals.filter { $0.kind == .flight }.count
		}
		if flights(next) > flights(marks) { Hint.noteMeasuredJump() }
		history.append(marks)
		future = []
		marks = next
	}

	func undo() {
		guard let previous = history.popLast() else { return }
		future.append(marks)
		marks = previous
	}

	func redo() {
		guard let next = future.popLast() else { return }
		history.append(marks)
		marks = next
	}

	func frameTaken(_ frame: Int, except id: String? = nil) -> Bool {
		marks.contains { $0.id != id && timing.frame(ofMarkTime: $0.time) == frame }
	}

	/// The mark on the frame on screen.
	var markOnFrame: Mark? { marks.first { timing.frame(ofMarkTime: $0.time) == player.frame } }

	var action: MarkAction { markAction(marks, frame: player.frame, timing: timing, jumpType: jumpType) }

	@ObservationIgnored private var markChain: Task<Void, Never>?

	/// Marks go on the frame the playhead was sent to when they were asked for, once that frame
	/// is on screen (the player shows it before any later step). They're applied one at a time,
	/// in the order pressed, however quickly keys arrive.
	private func enqueueMark(_ apply: @escaping @MainActor (Int) -> Void) {
		player.pause()
		let target = player.frame
		// The stop is registered now, so steps pressed after the mark come after its frame;
		// only the commits wait their turn.
		let stop = player.addStop(target)
		let previous = markChain
		markChain = Task {
			await previous?.value
			// Closed or replaced while waiting: the mark has no frame to go on.
			guard await player.waitForStop(stop), player.info?.url == info.url else { return }
			apply(target)
		}
	}

	func place(_ type: MarkType) {
		enqueueMark { frame in
			self.commit(placeMark(self.marks, type: type, time: self.timing.startTime(ofFrame: frame), timing: self.timing))
		}
	}

	/// The Mark button (M): marks the step that belongs on the frame on screen, or, when that
	/// frame is already marked, calls `openEditor`.
	func pressMark(openEditor: @escaping @MainActor () -> Void = {}) {
		enqueueMark { frame in
			switch markAction(self.marks, frame: frame, timing: self.timing, jumpType: self.jumpType) {
			case .add(let step):
				self.commit(placeMark(self.marks, type: step.markType, time: self.timing.startTime(ofFrame: frame), timing: self.timing))
			// Only while the playhead is still on that mark: later steps move on from it.
			case .onFrame: if self.player.frame == frame { openEditor() }
			case .choose: break
			}
		}
	}

	/// Why a mark can't move a frame that way, or nil when it can.
	func nudgeBlocked(_ mark: Mark, by frames: Int) -> String? {
		let frame = timing.frame(ofMarkTime: mark.time) + frames
		if frame < 0 || frame > player.lastFrame { return frames < 0 ? "Already the first frame" : "Already the last frame" }
		if frameTaken(frame, except: mark.id) { return "Another mark is on that frame" }
		return nil
	}

	func nudge(_ mark: Mark, by frames: Int) {
		guard nudgeBlocked(mark, by: frames) == nil else { return }
		let frame = timing.frame(ofMarkTime: mark.time) + frames
		commit(moveMark(marks, id: mark.id, time: timing.startTime(ofFrame: frame)))
		Task { await player.seek(toFrame: frame) }
	}

	@discardableResult
	func move(_ mark: Mark, toFrame frame: Int) -> Bool {
		let frame = timing.clamp(frame, duration: info.duration)
		guard !frameTaken(frame, except: mark.id) else { return false }
		if timing.frame(ofMarkTime: mark.time) != frame {
			commit(moveMark(marks, id: mark.id, time: timing.startTime(ofFrame: frame)))
		}
		return true
	}

	func remove(_ mark: Mark) { commit(removeMark(marks, id: mark.id)) }

	func seek(to mark: Mark) {
		Task { await player.seek(toFrame: timing.frame(ofMarkTime: mark.time)) }
	}

	func seekAdjacentMark(_ direction: Int) {
		let frame = player.frame
		let sorted = sortMarks(marks)
		let target = direction > 0
			? sorted.first { timing.frame(ofMarkTime: $0.time) > frame }
			: sorted.last { timing.frame(ofMarkTime: $0.time) < frame }
		if let target { seek(to: target) }
	}

	func markName(_ mark: Mark) -> String { markStep(marks, mark).label(jumpType) }
}
