(function (window) {

	var WORKER_PATH = 'js/recorderWorker.js';
	var encoderWorker = new Worker('js/mp3Worker.js');

	var Recorder = function (sourceNode, cfg) {
		var config = cfg || {};

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

		sourceNode.connect(this.processorNode);
		this.processorNode.connect(this.context.destination);

		var worker = new Worker(config.workerPath || WORKER_PATH);
		worker.postMessage({
			command: 'init',
			config: {
				sampleRate: this.context.sampleRate
			}
		});

		// MP3 conversion
		worker.onmessage = function (e) {
			var callbackId = e.data.callbackId,
				callback = callbackId ? getCallback(callbackId) : null;

			var command = e.data.command;

			switch (command) {
				case "exportWAV":
					var blob = e.data.blob;

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

								/*
								var audio = new Audio();
								audio.src = url;
								audio.play();
								*/

								var mp3Blob = new Blob(
									[ new Uint8Array(e.data.buf) ],
									{ type: 'audio/mp3' }
								);

								uploadAudio(mp3Blob);

								var li = document.createElement('li');
								var au = document.createElement('audio');
								var hf = document.createElement('a');

								au.controls = true;
								au.src = url;
								hf.href = url;
								hf.download = 'audio_recording_' + new Date().getTime() + '.mp3';
								hf.innerHTML = hf.download;
								li.appendChild(au);
								li.appendChild(hf);
								recordingslist.appendChild(li);
							}
						};
					};

					fileReader.readAsArrayBuffer(blob);

					if (callback) { callback(blob); }
					break;
				case "getBuffer":
					if (callback) { callback(e.data.buffers); }
					break;
			}
		};

		this.configure = function (cfg) {
			for (var prop in cfg) {
				if (cfg.hasOwnProperty(prop)) {
					config[prop] = cfg[prop];
				}
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

		function uploadAudio (mp3Data) {
			var reader = new FileReader();

			reader.onload = function (event) {
				var fd = new FormData();
				var mp3Name = encodeURIComponent('audio_recording_' + new Date().getTime() + '.mp3');
				fd.append('fname', mp3Name);
				fd.append('data', event.target.result);
				$.ajax({
					type: 'POST',
					url: 'upload.php',
					data: fd,
					processData: false,
					contentType: false
				}).done(function (data) {
					//console.log(data);
				});
			};

			reader.readAsDataURL(mp3Data);
		}
	};

	/*
	Recorder.forceDownload = function (blob, filename) {
		var clickEvent = document.createEvent("Event");
		clickEvent.initEvent("click", true, true);

		var url = (window.URL || window.webkitURL).createObjectURL(blob);

		var link = window.document.createElement('a');
		link.href = url;
		link.download = filename || 'output.wav';
		link.dispatchEvent(clickEvent);
	}
	*/

	window.Recorder = Recorder;

})(window);
