module.exports = function(config) {
  config.set({
    frameworks: ['jasmine'],
    files: [
      'test.js'
    ],
    singleRun: true,
    browsers: ['jsdom'],
	client: {
	    captureConsole: false
	},
	reporters: ['spec'],
	specReporter: {
	    maxLogLines: 10,
	    suppressErrorSummary: true,
	    suppressFailed: false,
	    suppressPassed: false,
	    suppressSkipped: true
	}
  })
}