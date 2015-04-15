(function (window) {

	var RECORDER_WORKER_PATH = 'recorderWorker.js';
	var ENCODER_WORKER_PATH = 'mp3Worker.js';

	var encoderWorker;

	var Recorder = function (sourceNode, cfg) {
		var config = {
			bufferLen: null,
			workersBasePath: "js/",
			type: null
		};

		this.configure = function (cfg) {
			for (var prop in cfg) {
				if (config.hasOwnProperty(prop)) {
					config[prop] = cfg[prop];
				}
			}
		};

		this.configure(cfg);

		encoderWorker = new Worker(config.workersBasePath + ENCODER_WORKER_PATH);

		var callbacks = {},
			nextCallbackId = 0;

		function addCallback(callback) {
			callbacks[++nextCallbackId] = callback;
			return nextCallbackId;
		}

		function getCallback (id) {
			var callback = callbacks[id];
			if (!callback) { throw new Error("Recorder: can't find callback '" + id + "'"); }
			delete callbacks[id];
			return callback;
		}

		var recording = false;

		var bufferLen = config.bufferLen || 4096;

		this.context = sourceNode.context;

		this.processorNode = (this.context.createScriptProcessor || this.context.createJavaScriptNode).call(this.context, bufferLen, 2, 2);
		this.processorNode.onaudioprocess = function (e) {
			if (!recording) return;
			worker.postMessage({
				command: 'record',
				buffer: [
					e.inputBuffer.getChannelData(0),
					//e.inputBuffer.getChannelData(1)
				]
			});
		};

		this.setSourceNode = function (sourceNode) {
			sourceNode.connect(this.processorNode);
		};

		this.setSourceNode(sourceNode);

		this.processorNode.connect(this.context.destination);

		var worker = new Worker(config.workersBasePath + RECORDER_WORKER_PATH);
		worker.postMessage({
			command: 'init',
			config: {
				sampleRate: this.context.sampleRate
			}
		});

		worker.onmessage = function (e) {
			var callbackId = e.data.callbackId,
				callback = callbackId ? getCallback(callbackId) : null;

			var command = e.data.command;

			switch (command) {
				case "exportWAV":
					if (callback) { callback(e.data.blob); }
					break;
				case "getBuffer":
					if (callback) { callback(e.data.buffers); }
					break;
			}
		};

		this.record = function () {
			recording = true;
		};

		this.stop = function () {
			recording = false;
		};

		this.clear = function () {
			worker.postMessage({ command: 'clear' });
		};

		this.getBuffer = function (cb) {
			if (!cb) { throw new Error('getBuffer: Callback not set'); }
			var callbackId = addCallback(cb);
			worker.postMessage({ command: 'getBuffer', callbackId: callbackId })
		};

		this.exportWAV = function (cb, type) {
			if (!cb) { throw new Error('exportWAV: Callback not set'); }
			var callbackId = addCallback(cb);

			type = type || config.type || 'audio/wav';
			worker.postMessage({
				command: 'exportWAV',
				callbackId: callbackId,
				type: type
			});
		};

		this.encodeMP3 = function (wavBlob, callback) {
			if (!callback) { throw new Error('encodeMP3: Callback not set'); }

			var arrayBuffer;

			var fileReader = new FileReader();
			fileReader.onload = function () {
				arrayBuffer = this.result;

				var buffer = new Uint8Array(arrayBuffer),
					data = parseWav(buffer);

				encoderWorker.postMessage({ cmd: 'init', config:{
					mode : 3,
					channels:1,
					samplerate: data.sampleRate,
					bitrate: data.bitsPerSample
				}});

				encoderWorker.postMessage({ cmd: 'encode', buf: Uint8ArrayToFloat32Array(data.samples) });
				encoderWorker.postMessage({ cmd: 'finish' });

				encoderWorker.onmessage = function (e) {
					if (e.data.cmd == 'data') {
						var url = 'data:audio/mp3;base64,' + encode64(e.data.buf);

						var mp3Blob = new Blob(
							[ new Uint8Array(e.data.buf) ],
							{ type: 'audio/mp3' }
						);

						callback(mp3Blob, url);
					}
				};
			};

			fileReader.readAsArrayBuffer(wavBlob);
		}

		function encode64 (buffer) {
			var binary = '',
				bytes = new Uint8Array( buffer ),
				len = bytes.byteLength;

			for (var i = 0; i < len; i++) {
				binary += String.fromCharCode( bytes[ i ] );
			}

			return window.btoa( binary );
		}

		function parseWav (wav) {
			function readInt(i, bytes) {
				var ret = 0,
					shft = 0;

				while (bytes) {
					ret += wav[i] << shft;
					shft += 8;
					i++;
					bytes--;
				}
				return ret;
			}

			if (readInt(20, 2) != 1) throw 'Invalid compression code, not PCM';
			if (readInt(22, 2) != 1) throw 'Invalid number of channels, not 1';

			return {
				sampleRate: readInt(24, 4),
				bitsPerSample: readInt(34, 2),
				samples: wav.subarray(44)
			};
		}

		function Uint8ArrayToFloat32Array (u8a) {
			var f32Buffer = new Float32Array(u8a.length);
			for (var i = 0; i < u8a.length; i++) {
				var value = u8a[i<<1] + (u8a[(i<<1)+1]<<8);
				if (value >= 0x8000) value |= ~0x7FFF;
				f32Buffer[i] = value / 0x8000;
			}
			return f32Buffer;
		}
	};

	Recorder.isBrowserCompatible = function () {
		if (window.Worker && window.Float32Array && window.FileReader) {
			return true;
		}
		return false;
	};

	window.Recorder = Recorder;

})(window);
