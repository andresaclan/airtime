/// <reference lib="webworker" />
/**
 * Shrinks decoded frames to proxy size and turns them upright, for the scrub cache
 * worker (scrubCache.worker.ts) to re-encode.
 *
 * Two ways, and which is faster depends on the browser and the machine: a 2D canvas
 * converts the frame on the CPU in Firefox (about 14 ms a 1080p frame, most of a
 * build), where WebGL scales it on the GPU in a fraction of that; Chromium without
 * a GPU runs WebGL in software, several times slower than its 2D canvas. So the
 * first frames go through each in turn, and the faster one does the rest.
 */

export type Rotation = 0 | 90 | 180 | 270;

/** Draws `decoded` at proxy size, upright, as a new frame stamped `timestamp`. */
type Scale = (decoded: VideoFrame, timestamp: number) => VideoFrame;

/** Frames timed per way before choosing; the first of each warms it up and isn't counted. */
const TRIALS = 5;

function canvasScaler(width: number, height: number, rotation: Rotation): Scale {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d', { alpha: false })!;
	const quarterTurn = rotation === 90 || rotation === 270;
	const w = quarterTurn ? height : width;
	const h = quarterTurn ? width : height;
	return (decoded, timestamp) => {
		context.save();
		context.translate(width / 2, height / 2);
		context.rotate((rotation * Math.PI) / 180);
		context.drawImage(decoded, -w / 2, -h / 2, w, h);
		context.restore();
		return new VideoFrame(canvas, { timestamp });
	};
}

const VERTEX_SHADER = `#version 300 es
in vec2 corner;
uniform int turns;
out vec2 source;
void main() {
	// Where this corner of the output is, y down, and where that is in the decoded
	// frame: the output is the frame turned clockwise.
	vec2 at = vec2(corner.x + 1.0, 1.0 - corner.y) / 2.0;
	if (turns == 1) source = vec2(at.y, 1.0 - at.x);
	else if (turns == 2) source = 1.0 - at;
	else if (turns == 3) source = vec2(1.0 - at.y, at.x);
	else source = at;
	gl_Position = vec4(corner, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 source;
uniform sampler2D frame;
out vec4 color;
void main() {
	color = texture(frame, source);
}`;

function webglScaler(width: number, height: number, rotation: Rotation): Scale | null {
	const canvas = new OffscreenCanvas(width, height);
	const gl = canvas.getContext('webgl2', {
		alpha: false,
		antialias: false,
		depth: false,
		preserveDrawingBuffer: true
	});
	if (!gl) return null;
	const shader = (type: number, source: string) => {
		const compiled = gl.createShader(type)!;
		gl.shaderSource(compiled, source);
		gl.compileShader(compiled);
		return compiled;
	};
	const program = gl.createProgram()!;
	gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX_SHADER));
	gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
	gl.useProgram(program);
	gl.uniform1i(gl.getUniformLocation(program, 'turns'), rotation / 90);

	gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
	const corner = gl.getAttribLocation(program, 'corner');
	gl.enableVertexAttribArray(corner);
	gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

	gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
	// Mipmaps, so shrinking 4K by three or more averages pixels instead of skipping them.
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.viewport(0, 0, width, height);

	return (decoded, timestamp) => {
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, decoded);
		gl.generateMipmap(gl.TEXTURE_2D);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		return new VideoFrame(canvas, { timestamp });
	};
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

/** A scaler that tries each way on the first frames and keeps the faster. */
export function createScaler(width: number, height: number, rotation: Rotation): Scale {
	const ways: Scale[] = [canvasScaler(width, height, rotation)];
	try {
		const webgl = webglScaler(width, height, rotation);
		if (webgl) ways.push(webgl);
	} catch {
		// No WebGL in workers here; the canvas does it all.
	}
	const timings: number[][] = ways.map(() => []);
	let chosen: Scale | null = ways.length === 1 ? ways[0] : null;
	let trial = 0;
	return (decoded, timestamp) => {
		if (chosen) return chosen(decoded, timestamp);
		const way = trial++ % ways.length;
		const start = performance.now();
		let scaled: VideoFrame;
		try {
			scaled = ways[way](decoded, timestamp);
		} catch {
			// WebGL that can't take a VideoFrame: the canvas it is.
			chosen = ways[0];
			return chosen(decoded, timestamp);
		}
		timings[way].push(performance.now() - start);
		if (timings.every((times) => times.length >= TRIALS)) {
			const costs = timings.map((times) => median(times.slice(1)));
			chosen = ways[costs.indexOf(Math.min(...costs))];
		}
		return scaled;
	};
}
