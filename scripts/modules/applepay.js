define(['modules/jquery-mozu','modules/eventbus',"modules/api",'hyprlivecontext','underscore', "modules/backbone-mozu", 'modules/models-cart', 'modules/checkout/models-checkout-page', 'modules/models-checkout'
],
function($, EventBus, Api, hyprlivecontext, _, Backbone, CartModels, CheckoutModels, OrderModels) {
  var apiContext = require.mozuData('apicontext');
  var ApplePaySession = window.ApplePaySession;
  var ApplePayToken = Backbone.MozuModel.extend({
      mozuType: 'token',
      defaults: {
        'type': 'APPLEPAY'
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
        if (this.isCart){
          this.cart = CartModels.Cart.fromCurrent();
        }
        // configure button with selected style and language
        this.setStyle(style);
        this.setLanguage();
        /*
          canMakePayments passes if:
          - the user is on the most recent version of Safari on OSX sierra or a recent iPad
          - the user has a wallet set up on an iPhone (must be iPhone - not iPad)
        */
        if (ApplePaySession && ApplePaySession.canMakePayments()){
          self.getOrder().then(function(orderModel){

            $("#applePayButton").show();
            $("#applePayButton").on('click', function(event){


              //orderModel at this point could be an order OR a checkout
              console.log(orderModel);

              var request = self.buildRequest();
              var applePayToken = new ApplePayToken();

              // define our ApplePay Session with the version number
              self.session = new ApplePaySession(3, request);

              // set handlers. These all get called by apple.
              self.session.onvalidatemerchant = function(event){
                  var validationURL = event.validationURL;

                  applePayToken.set('domain', window.location.hostname);
                  applePayToken.set('storeName', self.storeName);
                  applePayToken.apiGetSession().then(function(response){
                    console.log(response);
                    self.session.completeMerchantValidation(response);
                  }, function(error){
                      //TODO: make sure api handles and returns this error appropriately
                      console.log(error);
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
                //event holds onto the payment token.
                var status = 0;
                applePayToken.set('tokenObject', event.payment.token);
                applePayToken.apiCreate().then(function(response){
                  if (!response.isSuccessful){
                    //TODO: Need to know how errors are going to come through.
                    // We have to set the status of the authorization manually.
                    // We'll be getting information from the event object and/or the  if there is a problem
                    // so we need to figure out what that will look like and how to handle it.

                  } else {

                  }
                  self.session.completePayment({"status": status});
                });


              };
              //TODO: define oncancel handler
              self.session.begin();
            });
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
        $("#applePayButton").attr('lang', locale.substring(0, 2));
    },
    getOrder: function(){
        var self = this;
        if (this.isCart){
            if (this.multishipEnabled){
                return this.cart.apiCheckout2().then(function(responseData){
                    return responseData;
                    //return new CheckoutModels.CheckoutPage(responseData);
                });
            } else {
                return this.cart.apiCheckout().then(function(responseData){
                    return responseData;
                    //return new OrderModels.CheckoutPage(responseData);
                });
            }
        } else {
            // TODO: We're in checkout, we can get the current checkout or order object.
            // Still needs to be returned as a Promise.
        }
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
        //toFixed returns a string. We are fine with that.
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
