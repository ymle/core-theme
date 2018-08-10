define(['modules/jquery-mozu','modules/eventbus',"modules/api",'hyprlivecontext','underscore'],
function($,EventBus, Api, hyprlivecontext, _) {
  var ApplePaySession = window.ApplePaySession;
  var initialized = false;
  var ApplePay = {
    init: function(style){
      if (!initialized){
        initialized = true;
        this.setStyle(style);
        this.setLanguage();
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

              self.session = new ApplePaySession(3, request);
              self.session.onvalidatemerchant = function(event){
                  var validationURL = event.validationURL;
                  console.log(J({'validationURL': validationURL}));
                  $.ajax({
                      type: 'POST',
                      url: 'https://shelkeller.ngrok.io/merchant-session/new',
                      data: $.params({'validationURL': validationURL}),
                      dataType: 'json',
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
                  console.log("on payment method selected");
                  self.session.completePaymentMethodSelection(event);
              };
              self.session.onshippingmethodselected = function(event){
                  console.log("on shipping method selected");
                  self.session.completeShippingMethodSelected(event);
              };
              self.session.onshippingcontactselected = function(event) {
                  console.log("on shipping contact selected");
                  self.session.completeShippingContactSelected(event);
              };
              self.session.begin();
            });
            // remove hidden class from button
            // add listener to button to run session maker

        } else {
          if ($("#applePayButton")){
              $("#applePayButton").hide();
          }
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
