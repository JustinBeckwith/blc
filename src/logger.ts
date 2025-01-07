export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARNING = 2,
	ERROR = 3,
	NONE = 4,
}

export enum Format {
	TEXT = 0,
	JSON = 1,
	CSV = 2,
	MD = 3,
}

export class Logger {
	constructor(
		public level: LogLevel,
		public format: Format,
	) {}

	debug(message?: string) {
		if (this.level <= LogLevel.DEBUG && this.format === Format.TEXT) {
			console.debug(message);
		}
	}

	info(message?: string) {
		if (this.level <= LogLevel.INFO && this.format === Format.TEXT) {
			console.info(message);
		}
	}

	warn(message?: string) {
		if (this.level <= LogLevel.WARNING && this.format === Format.TEXT) {
			// Note: this is `console.log` on purpose.  `console.warn` maps to
			// `console.error`, which would print these messages to stderr.
			console.log(message);
		}
	}

	error(message?: string) {
		if (this.level <= LogLevel.ERROR && this.format === Format.TEXT) {
			console.error(message);
		}
	}
}
