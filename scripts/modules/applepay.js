define(['modules/jquery-mozu','modules/eventbus',"modules/api",'hyprlivecontext','underscore', "modules/backbone-mozu", 'modules/models-cart'
],
function($, EventBus, Api, hyprlivecontext, _, Backbone, CartModels) {
  var apiContext = require.mozuData('apicontext');
  var ApplePaySession = window.ApplePaySession;
  var ApplePayToken = Backbone.MozuModel.extend({
      mozuType: 'token',
      initialize: function(data){
        console.log(data);
      }
  });
  var ApplePay = {
    init: function(style){

        var self = this;
        var paymentSettings = _.findWhere(hyprlivecontext.locals.siteContext.checkoutSettings.externalPaymentWorkflowSettings, {"name" : "ApplePay"});
        /*if (!paymentSettings || !paymentSettings.isEnabled) return;
        this.isEnabled = paymentSettings.isEnabled;*/
        this.isEnabled = true;
        this.isCart = window.location.href.indexOf("cart") > 0;
        this.multishipEnabled = hyprlivecontext.locals.siteContext.generalSettings.isMultishipEnabled;
        this.storeName = hyprlivecontext.locals.siteContext.generalSettings.websiteName;
        this.cart = CartModels.Cart.fromCurrent();

        this.cart.apiCheckout().then(function(response){
          console.log(response);
        }, function(error){
          console.log(error);
        });


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


              var request = self.buildRequest();
              var applePayToken = new ApplePayToken({type: "APPLEPAY"});


              // define our ApplePay Session with the version number
              self.session = new ApplePaySession(3, request);

              // set handlers. These all get called by apple.
              self.session.onvalidatemerchant = function(event){
                  var validationURL = event.validationURL;
                  //TODO: replace this with api call
                  /*
                  applePayToken.domain = window.location.hostname;
                  applePayToken.storeName = self.storeName;
                  applePayToken.apiGetSession().then(function(){
                    self.session.completeMerchantValidation(response);
                  }, function(error){
                      //TODO: make sure api handles and returns this error appropriately
                      console.log(error);
                  });
                  */

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
                        "label": "Kibo (payment method selected)",
                        "amount": "11.00",
                        "type": "final"
                      },
                      newLineItems: []
                    }
                  );
              };
              self.session.onshippingcontactselected = function(event) {
                  //takes an ApplePayShippingContactUpdate object
                  //errors [String]
                  //newLineItems (optional)
                  //newShippingMethods (optional?)
                  //newTotal (required - has label, amount, and type strings)

                  //TODO:Apple expects an update to the price at this point.
                  //We should investigate what would cause that.
                  //We also need to pass an error object if there is a problem.
                  self.session.completeShippingContactSelection({
                    newTotal: {
                      "label": "Kibo (shipping contact selected)",
                      "amount": "11.00",
                      "type": "final"
                    },
                    newLineItems: []
                  });
              };
              self.session.onpaymentauthorized = function(event) {
                console.log("on payment authorized");
                console.log(event);
                //event holds onto the payment token.
                applePayToken.data = event.payment.token;

                /*applePayToken.apiSave().then(function(rtn){
                  //TODO: Need to know how errors are going to come through. */
                  self.session.completePayment({"status": 0});

                /*}, function(error){
                  console.log(error);
                });
                */
                //TODO: We have to set the status of the authorization manually.
                // We'll be getting information from the event object if there is a problem
                // so we need to figure out what that will look like and how to handle it.
              };
              //TODO: define oncancel handler
              self.session.begin();
            });

        } else {
          if ($("#applePayButton")){
              $("#applePayButton").hide();
          }
        }


    },
    setStyle: function(style){
        var self = this;
        var styleClass = "apple-pay-button-";
        if (!style){
          style = "black";
        }
        styleClass += style;
        $("#applePayButton").addClass(styleClass);
    },
    setLanguage: function(){
        var locale = apiContext.headers['x-vol-locale'];
        locale.substring(0, 2);
        $("#applePayButton").attr('lang', locale.substring(0, 2));
    },
    buildRequest: function(){
      /* build the request out of the store name, order total,
      available payment methods. determine which contact fields are necessary
      based one whether we're in checkout or cart.
      */
      var self = this;
      var supportedCards = hyprlivecontext.locals.siteContext.checkoutSettings.supportedCards;
      var supportedNetworks = [];

      Object.keys(supportedCards).forEach(function (key){
          if (supportedCards[key] =="MC"){
            supportedNetworks.push("mastercard");
          } else if (supportedCards[key].toLowerCase() == "applepay") {
            return;
          } else {
            supportedNetworks.push(supportedCards[key].toLowerCase());
          }
      });
        var totalAmount = 10;
        var requiredShippingContactFields = [];
        if (this.isCart){
          requiredShippingContactFields = [
            "postalAddress",
            "name",
            "phone",
            "email"
          ];
          totalAmount = this.cart.attributes.total;
        } else {
          //total should be set with the checkout or order info.
        }
        //toFixed returns a string. We want that.
        var total = { label: self.storeName, amount: totalAmount.toFixed(2) };
        var requiredBillingContactFields = [
            'postalAddress',
            'name'
        ];

        var request = {
          countryCode: apiContext.headers['x-vol-locale'].slice(-2),
          currencyCode: apiContext.headers['x-vol-currency'],
          supportedNetworks: supportedNetworks,
          total: total,
          merchantCapabilities: ['supports3DS'],
          requiredShippingContactFields: requiredShippingContactFields,
          requiredBillingContactFields: requiredBillingContactFields
        };
        return request;
    }
  };
  return ApplePay;
});
