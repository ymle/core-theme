/* runtest.js */ 
var page = require('webpage').create(); 
var fs = require('fs'); 
var index = 'file:///' + fs.workingDirectory + '/index.html';
var JasmineConsoleReporter = require('jasmine-console-reporter');

var reporter = new JasmineConsoleReporter({
    colors: 1,
    cleanStack: 1,
    verbosity: 4,
    listStyle: 'indent',
    activity: false
});

// load the index.html 
page.open(indexfile, function(status) { 
    if (status !== 'success') { 
        console.log('Unable to load the index' + index); 
    } else { 
        window.setTimeout(function() { 
            // once loaded, we can inject the needed javascripts 
            // make sure to have jasmine.js in the same folder 
            page.injectJS('jasmine.js'); 
            // inject console runner and the tests themselves 
            page.injectJS('test.js'); 
            // init the console reporter and execute the tests 
            // from jasmine 
            page.evaluate(function(){ 
                jasmine.getEnv().addReporter(new jasmine.TrivialReporter()); 
                jasmine.getEnv().addReporter(reporter); 
                jasmine.getEnv().execute(); 
            }); 
        }, 200); 
    } 
}); 
// handle console messages and the end of testing 
page.onConsoleMessage = function(msg) { 
    if(msg === "ConsoleReporter finished") { 
        phantom.exit(); 
    } 
    // the pages open in a sandbox, so in order for console 
    // messages to reach us we need catch them and to 
    //  pass them along 
    return console.log(msg); 
};