// var jsdom = require("jsdom");
// jsdom.env(
//   "https://t17238-s26790.sandbox.mozu.com",
//   ["http://code.jquery.com/jquery.js"],
//   function (errors, window) {
//     console.log("My site Name", window.$("title").text());
//   }
// );
// 
// 

// var webPage = require('webpage');
// var page = webPage.create();
// page.open('https://t17238-s26790.sandbox.mozu.com', settings, function(status) {
//   console.log('Status: ' + status);
//   // Do other things here...
// });

module.exports = function(config) {
  config.set({
    frameworks: ['jasmine'],
    files: [
      'test.js'
    ],
    singleRun: true,
    browsers: ['PhantomJS_custom'],
    customLaunchers: {
      'PhantomJS_custom': {
        base: 'PhantomJS',
        options: {
          settings: {
          	localToRemoteUrlAccess: true,
            webSecurityEnabled: false,
            open: pageOpen();
          },
        },
        flags: ['--load-images=false'],
        debug: true
      }
    },
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