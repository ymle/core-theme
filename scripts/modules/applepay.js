define(['modules/jquery-mozu','modules/eventbus',"modules/api",'hyprlivecontext','underscore'],
function($,EventBus, Api, hyprlivecontext, _) {
  var ApplePaySession = window.ApplePaySession;
  var ApplePay = {
    init: function(style){
        var self = this;
        // configure button with selected style and language
        this.setStyle(style);
        this.setLanguage();

        /*
          canMakePayments passes if:
          - the user is on the most recent version of Safari on OSX sierra or a recent iPad
          - the user has a wallet set up on an iPhone (must be iPhone - not iPad)
        */
        if (ApplePaySession && ApplePaySession.canMakePayments()){
            $("#applePayButton").show();
            $("#applePayButton").on('click', function(event){

              //TODO: populate this request with accurate information

              var request = {
                countryCode: 'US',
                currencyCode: 'USD',
                supportedNetworks: ['visa', 'masterCard', 'amex', 'discover'],
                total: { label: 'Kibo', amount: '10.00' },
                merchantCapabilities: ['supports3DS']
              };

              // define our ApplePay Session with the version number
              self.session = new ApplePaySession(3, request);

              // set handlers. These all get called by apple.
              self.session.onvalidatemerchant = function(event){
                  var validationURL = event.validationURL;
                  $.ajax({
                      type: 'POST',
                      url: 'https://shelkeller.ngrok.io/merchant-session/new?validationURL='+validationURL+'&domainName='+window.location.hostname,
                      dataType: 'json',
                      contentType: 'application/json',
                      success: function(response){
                          console.log(response);
                          self.session.completeMerchantValidation(response);
                      },
                      error: function(error){
                        console.log(error);
                      }
                  });
              };


              self.session.onpaymentmethodselected = function(event){
                  console.log(event);
                  self.session.completePaymentMethodSelection(
                    {
                      newTotal: {
                        "label": "NewTotal Label",
                        "amount": "10.00",
                        "type": "final"
                      },
                      newLineItems: []
                    }
                  );
              };
              self.session.onshippingmethodselected = function(event){
                  console.log("on shipping method selected");
                  self.session.completeShippingMethodSelected(event);
              };
              self.session.onshippingcontactselected = function(event) {
                  console.log("on shipping contact selected");
                  self.session.completeShippingContactSelected(event);
              };
              self.session.onpaymentauthorized = function(event) {
                console.log("on payment authorized");
                console.log(event);
                //event holds onto the payment token.

                //TODO: We have to set the status of the authorization manually.
                // We'll be getting information from the event object if there is a problem
                // so we need to figure out what that will look like and how to handle it.
                var result = self.session.completePayment({"status": 0});
                console.log(result);
              }
              //TODO: define oncancel handler

              //
              self.session.begin();
            });
            // remove hidden class from button
            // add listener to button to run session maker

        } else {
          if ($("#applePayButton")){
              $("#applePayButton").hide();
          }
        }


    },
    setStyle: function(style){
        var self = this;
        var styleClass = "apple-pay-button-"
        if (!style){
          style = "black";
        }
        styleClass += style;
        $("#applePayButton").addClass(styleClass);
    },
    setLanguage: function(){
        var apiContext = require.mozuData('apicontext');
        var locale = apiContext.headers['x-vol-locale'];
        locale.substring(0, 2);
        $("#applePayButton").attr('lang', locale.substring(0, 2));
    }
  };
  return ApplePay;
});
