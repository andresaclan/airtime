export type Size = { width: number; height: number };
export type Box = { left: number; top: number; width: number; height: number };

/**
 * Where the picture sits inside a container that centres the video element. The
 * scrub preview covers this box. It's the picture's box, not the element's: with
 * object-fit: contain the element can be larger than its picture (Safari stretches
 * it across the space and letterboxes the picture), and a preview sized to the
 * element would stretch a 9:16 frame to the full width.
 *
 * `picture` is the video's intrinsic size; zero while the metadata hasn't loaded,
 * when the element's own box is the best guess.
 */
export function pictureBox(container: Size, element: Size, picture: Size): Box {
	let { width, height } = element;
	if (picture.width > 0 && picture.height > 0) {
		const scale = Math.min(width / picture.width, height / picture.height);
		width = picture.width * scale;
		height = picture.height * scale;
	}
	return {
		left: (container.width - width) / 2,
		top: (container.height - height) / 2,
		width,
		height
	};
}
