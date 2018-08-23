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

                  applePayToken.set('domain', window.location.hostname);
                  applePayToken.set('storeName', self.storeName);
                  applePayToken.apiGetSession().then(function(response){
                    console.log(response);
                    self.session.completeMerchantValidation(response);
                  }, function(error){
                      //TODO: make sure api handles and returns this error appropriately
                      console.log(error);
                  });


                  // $.ajax({
                  //     type: 'POST',
                  //     url: 'https://shelkeller.ngrok.io/merchant-session/new?validationURL='+validationURL+'&domainName='+window.location.hostname,
                  //     dataType: 'json',
                  //     contentType: 'application/json',
                  //     success: function(response){
                  //         console.log(response);
                  //         self.session.completeMerchantValidation(response);
                  //     },
                  //     error: function(error){
                  //       console.log(error);
                  //     }
                  // });
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
                applePayToken.tokenObject = event.payment.token;
                applePayToken.apiCreate().then(function(res){
                  //TODO: Need to know how errors are going to come through. */
                  // We have to set the status of the authorization manually.
                  // We'll be getting information from the event object if there is a problem
                  // so we need to figure out what that will look like and how to handle it.
                  self.session.completePayment({"status": 0});
                });


              };
              //TODO: define oncancel handler
              self.session.begin();
            });

        } else {
          if ($("#applePayButton")){
              $("#applePayButton").hide();
          }
          //
          var tokenString = "{\"paymentData\":{\"version\":\"EC_v1\",\"data\":\"WgTJBgi1vpdkkvr9ivRFjr+iba13OBSaRx519UHkqC8b/hNV/3Nrc59kHk03+r8/b8VyfjlXcKT9hWCoBow03Qi43a9OJKFewxcWp40qBoO/jznZwG+Ao5jYkKzW4/7O5OWnA9spy3+Zy+sQ3ZHNySHc0WbeerlWIK7we3k4KBoJqlnDMdKnycGN9fOLxWuo8H800yN6vOwrNG9Coc8oKIMEuiSMJPq84wNxa/F6l/DHR82ZOFgmN9xCPEfGu3VDUtLeZo/M+s4nvtrzGXtwY29+He5A16wsIcBGCpvNpx5UCxKPFQD1O1fjikYWN72zNkx+5yhdTrzzPRxHQn/Xj+BjPphH42SKbFjbPL67eX3YDY5KSRxIdD9QklozqGeNoHm5F6ADkbKG22Fw3S9Qms9QOaUNRBQjw1JuVHs3ReM=\",\"signature\":\"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\",\"header\":{\"ephemeralPublicKey\":\"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEEdBw3FWw7XmlWQ8C4lcvrMwN65PZWvY+TkpbY05YuZtruv0YZe62kXwFs7Jr9tISY2dAbkar4RdViGlpIiW2cg==\",\"publicKeyHash\":\"/B8OLk+GX4qVHUiILaK2Q4uXNABKlVWZHLgWVViiJd4=\",\"transactionId\":\"f5d217ca0776761eebbf041bbfb8c48a120eb6e095e80c6a0bd0da85e01cca48\"}},\"paymentMethod\":{\"displayName\":\"Visa 0121\",\"network\":\"Visa\",\"type\":\"credit\"},\"transactionIdentifier\":\"F5D217CA0776761EEBBF041BBFB8C48A120EB6E095E80C6A0BD0DA85E01CCA48\"}";
          var tokenObject = JSON.parse(tokenString);
          var token = new ApplePayToken({tokenObject});
          token.apiCreate().then(function(rtn){
              console.log("returned!");
              console.log(rtn);
          }, function(error){
              console.log("Error!");
              console.log(error);
          });
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
