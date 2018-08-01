define(['modules/jquery-mozu','modules/eventbus',"modules/api",'hyprlivecontext','underscore'],
function($,EventBus, Api, hyprlivecontext, _) {

  var ApplePaySession = window.ApplePaySession;
  var ApplePay = {
    init: function(){
      var self = this;
      if (ApplePaySession && ApplePaySession.canMakePayments()){
          $("#applePayButton").show();
          $("#applePayButton").on('click', function(event){
            var request = {
              countryCode: 'US',
              currencyCode: 'USD',
              supportedNetworks: ['visa', 'masterCard', 'amex', 'discover'],
              total: { label: 'Kibo', amount: '10.00' },
              merchantCapabilities: ['supports3DS']
            };

            this.session = new ApplePaySession(3, request);
            this.session.onvalidatemerchant = function(event){
                console.log('on validate merchant called');
                $.post('https://276f2cac.ngrok.io/merchant-session/new', event, function(response){
                    console.log(response);
                });
            };
            this.session.begin();
          });
          // remove hidden class from button
          // add listener to button to run session maker

      } else {
        if ($("#applePayButton")){
            console.log($("#applePayButton"));
            $("#applePayButton").hide();
        }
      }
    },
    onClick: function(e){

    }

  };
  return ApplePay;
});
