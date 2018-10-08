define([
    'modules/jquery-mozu',
    'blockui'
], function($, blockui) {
	var blockUiLoader = {		
		globalLoader: function(){
			$.blockUI({
		        message: '<div><img style="width: 50%;" src="/resources/images/loader_crest.gif" alt="Loading..." /></div><div class="fa fa-spinner fa-spin"></div>',
		        css: {
		            border: 'none',
		            padding: '15px',
		            backgroundColor: 'transparent',
		            '-webkit-border-radius': '10px',
		            '-moz-border-radius': '10px',
		            opacity: 1,
		            color: '#fff',
		            fontSize: '60px'
		        }
	    	});
		},
		productValidationMessage: function(){
			$.blockUI({
		        message: $('#SelectValidOption'),
		        css: {
		            border: 'none',
		            padding: '15px',
		            backgroundColor: '#fff',
		            opacity: 1,
		            color: '#000',
		            width:'auto',
					left:'50%',
					transform: 'translate(-50%, -50%)',
					fontSize: '14px'
		        }
	    	});
		},
		unblockUi: function(){
			$.unblockUI();
		}
	};
	return blockUiLoader;
});