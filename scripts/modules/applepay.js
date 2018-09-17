define(['modules/jquery-mozu', 'hyprlive' ,"modules/api",'hyprlivecontext','underscore', "modules/backbone-mozu", 'modules/models-cart', 'modules/checkout/models-checkout-page', 'modules/models-checkout', 'modules/models-token'
],
function($, Hypr, Api, hyprlivecontext, _, Backbone, CartModels, CheckoutModels, OrderModels, TokenModels) {
  var apiContext = require.mozuData('apicontext');
  var ApplePaySession = window.ApplePaySession;
  var ApplePayCheckout = Backbone.MozuModel.extend({ mozuType: 'checkout'});
  var ApplePayOrder = Backbone.MozuModel.extend({ mozuType: 'order' });
  var ApplePay = {
    init: function(style){
        var self = this;
        var paymentSettings = _.findWhere(hyprlivecontext.locals.siteContext.checkoutSettings.externalPaymentWorkflowSettings, {"name" : "APPLEPAY"});
        if (!paymentSettings || !paymentSettings.isEnabled) return;
        if(self.scriptLoaded) return;
        self.scriptLoaded = true;
        this.isCart = window.location.href.indexOf("cart") > 0;
        this.multishipEnabled = hyprlivecontext.locals.siteContext.generalSettings.isMultishipEnabled;
        this.storeName = hyprlivecontext.locals.siteContext.generalSettings.websiteName;
        // configure button with selected style and language
        this.setStyle(style);
        this.setLanguage();
        /*
          canMakePayments passes if:
          - the user is on the most recent version of Safari on OSX sierra or a recent iPad
          - the user has a wallet set up on a logged-in, up-to-date iPhone (must be iPhone - not iPad)
        */
        if (ApplePaySession && ApplePaySession.canMakePayments()){
            $("#applePayButton").show();
            //assigning our click handler to the document so it still works after re-render

            $(document).off('click', '.apple-pay-button').on('click', '.apple-pay-button', function(event){
              var request = self.buildRequest();
              self.session = new ApplePaySession(3, request);
              self.getOrder().then(function(orderModel){
              //orderModel is either an ApplePayCheckout or ApplePayOrder
              self.orderModel = orderModel;
              self.applePayToken = new TokenModels.Token({ type: 'APPLEPAY' });

              // first define our ApplePay Session with the version number.
              // then we define a set of handlers that get called by apple.
              // after our session object knows how to respond to apple's various events,
              // we call begin(). The merchant is then validated, initializing
              // the 'true' session.

              // set handlers. These all get called by apple.
              self.session.onvalidatemerchant = function(event){
                  var validationURL = event.validationURL;
                  self.applePayToken.apiModel.thirdPartyPaymentExecute({
                      methodName: "Session",
                      cardType: "ApplePay",
                      body: {
                          domain: window.location.hostname,
                          storeName: self.storeName,
                          validationURL: validationURL
                      }
                    }).then(function(response){
                    // When apple is finished making this call,
                    // it opens the payment sheet and automatically selects
                    // available cards, addresses, and contact info, which triggers
                    // the following handlers.
                    self.session.completeMerchantValidation(response);

                  }, function(error){
                      self.handleError(error);
                  });
              };


              self.session.onpaymentmethodselected = function(event){
                  var amount = self.orderModel.get('amountRemainingForPayment');
                  self.session.completePaymentMethodSelection(
                    {
                      newTotal: {
                        "label": self.storeName,
                        "amount": amount,
                        "type": "final"
                      },
                      newLineItems: []
                    }
                  );
              };
              self.session.onshippingcontactselected = function(event) {
                  //these handlers each have a corresponding callback to apple
                  //apple expects us to have changed the price according to
                  //shipping costs at this point so we have to send them
                  // a 'new' amount

                  var amount = self.orderModel.get('amountRemainingForPayment');
                  self.session.completeShippingContactSelection({
                    newTotal: {
                      "label": self.storeName,
                      "amount": amount,
                      "type": "final"
                    },
                    newLineItems: []
                  });
              };

              self.session.onbillingcontactselected = function(event){
                var amount = self.orderModel.get('amountRemainingForPayment');
                self.session.completeBillingContactSelection({
                  newTotal: {
                    "label": self.storeName,
                    "amount": amount,
                    "type": "final"
                  },
                  newLineItems: []
                });
              };
              //This handler gets called after the user authorizes the wallet payment
              //on their phone. This is when we receive the payment token from apple.
              self.session.onpaymentauthorized = function(event) {
                var status = 0; // This is a 'successful' status. 'failure' is 1
                self.applePayToken.set('tokenObject', event.payment.token);
                self.applePayToken.apiCreate().then(function(response){
                  if (!response.isSuccessful){
                    self.handleError(null, "Could not create payment token.");
                  } else {
                    var appleBillingContact = event.payment.billingContact;
                    var appleShippingContact = event.payment.shippingContact;

                    var billingEmail = appleShippingContact.emailAddress;
                    var user = require.mozuData('user');
                    if (user && user.email) {
                        billingEmail = user.email;
                    }

                    var payload = {
                      amount: self.orderModel.get('amountRemainingForPayment'),
                      currencyCode: apiContext.headers['x-vol-currency'],
                      newBillingInfo: {
                          paymentType: 'token',
                          billingContact: {
                              email: billingEmail,
                              firstName: appleBillingContact.givenName,
                              lastNameOrSurname: appleBillingContact.familyName,
                              phoneNumbers: {
                                  home: appleShippingContact.phoneNumber
                              },
                              address: {
                                  address1: appleBillingContact.addressLines[0],
                                  address2: appleBillingContact.addressLines[1] || null,
                                  address3: appleBillingContact.addressLines[2] || null,
                                  address4: appleBillingContact.addressLines[3] || null,
                                  cityOrTown: appleBillingContact.locality,
                                  stateOrProvince: appleBillingContact.administrativeArea,
                                  postalOrZipCode: appleBillingContact.postalCode,
                                  countryCode: appleBillingContact.countryCode.toUpperCase()
                              }
                          },
                          token: {
                              paymentServiceTokenId: response.id,
                              type: 'applePay'
                          }
                      }
                    };

                    self.orderModel.apiCreatePayment(payload).then(function(order){

                      self.orderModel.set(order.data);
                      self.setShippingContact(appleShippingContact).then(function(shippingContactResponse){

                        if (shippingContactResponse && !self.multishipEnabled) {
                          // If we're in singleship, the response is some fulfillmentInfo data.
                          self.orderModel.set('fulfillmentInfo', shippingContactResponse.data);
                        } else if (shippingContactResponse && self.multishipEnabled) {
                          // If we're in multiship, the response is a whole new order object
                          // loaded with destinations.
                          self.orderModel.set(shippingContactResponse);
                        }

                        self.setShippingMethod().then(function(shippingMethodResponse){
                              if (shippingMethodResponse){
                                self.orderModel.set(shippingMethodResponse.data);
                              }
                              self.session.completePayment({"status": status});
                              var id = self.orderModel.get('id');
                              var redirectUrl = hyprlivecontext.locals.pageContext.secureHost;
                              var checkoutUrl = self.multishipEnabled ? "/checkoutv2" : "/checkout";
                              redirectUrl += checkoutUrl + '/' + id;
                              window.location.href = redirectUrl;

                      }, function(shippingMethodError){
                        self.handleError(shippingMethodError);
                      });
                    }, function(shippingContactError){
                        self.handleError(shippingContactError);
                    });
                }, function(createPaymentError){
                    self.handleError(createPaymentError);
                });
              }
            });
          };
          //Called if the modal is closed at any point
          self.session.oncancel = function(event){
              var self = this;
              if (self.orderModel && self.orderModel.apiModel.getCurrentPayment()){
                  var currentPayment = self.orderModel.apiModel.getCurrentPayment();
                  self.orderModel.apiVoidPayment(currentPayment.id);
              }
          };
          window.pageHasApplePaySession = true;
          self.session.begin();
          });
        });

        }

    },
    // We only want to get shipping info from the user via applePay if BOTH:
    // 1. We are currently on the cart. When we kick the user to checkout, shipping info will be populated.
    // 2. The cart has items that will be shipped. If it's all pickup items, we don't want to bother asking for shipping info and confuse them.
    isShippingInfoNeeded: function(){
        var self = this;
        if (!self.isCart) return false;
        this.cart = window.cartView.cartView.model;
        var hasShippingItem = false;
        var items = this.cart.get('items');
        items.forEach(function(item){
            if (item.get('fulfillmentMethod').toLowerCase() == "ship"){
                hasShippingItem = true;
            }
        });
        return hasShippingItem;
    },
    handleError: function(error, message){
      //error can be a the error object returned from a rejected promise
      //message can be a string if you want to pass in your own
      var self = this;
      var currentPayment = self.orderModel.apiModel.getCurrentPayment() || {};
      var errorMessage = "";
      if (error.items && error.items.length) {
          errorMessage = error.items[0].message;
      } else {
        errorMessage = error.message || message;
      }
      //this function works on both the cart page and the checkout page
      //a model which is attached to a backbone view with a messages element defined is necessary to trigger 'error'.
      //conveniently, we keep our cart and checkout backbone views stored on our window object.
      var errorMessageHandler;
      if (self.isCart){
          errorMessageHandler = window.cartView.cartView.model;
      } else {
          errorMessageHandler = window.checkoutViews.parentView.model;
      }
        self.orderModel.apiVoidPayment(currentPayment.id).ensure(function(response){
          // we use "ensure" instead of "then" in case currentPayment doesn't exist
          //"1" is an errored status message. the payment sheet will close.
         self.session.completePayment({"status": 1});
            errorMessageHandler.trigger('error', {
                message: errorMessage
            });
        });
    },
    setStyle: function(style){
        //TODO: there are only a few strings that will work here.
        //validate that we pass in an appropriate one
        var self = this;
        var styleClass = "apple-pay-button-";
        if (!style){
          style = "black";
        }
        styleClass += style;
        $("#applePayButton").addClass(styleClass);
    },
    setLanguage: function(){
      //This language setter will only matter if the merchant adds additional support
      //for displaying other kinds of Apple Pay buttons.
      //Right now the button will just say "[apple logo]Pay",
      //which doesn't change between languages.
        var locale = apiContext.headers['x-vol-locale'];
        $("#applePayButton").attr('lang', locale.substring(0, 2));
    },
    getOrder: function(){
        var self = this;
        if (this.isCart){
              this.cart = window.cartView.cartView.model;
            if (this.multishipEnabled){
                return this.cart.apiCheckout2().then(function(responseData){
                    return new ApplePayCheckout(responseData.data);
                }, function(error){
                    self.handleError(error);
                });
            } else {
                return this.cart.apiCheckout().then(function(responseData){
                    return new ApplePayOrder(responseData.data);
                }, function(error){
                    self.handleError(error);
                });
            }
        } else {
            if (this.multishipEnabled){
                var checkout = ApplePayCheckout.fromCurrent();
                return checkout.fetch();
            } else {
                var order = new ApplePayOrder(require.mozuData('checkout'));
                return order.fetch();
            }
        }
    },
    setShippingContact: function(appleShippingContact){
      if (!this.isShippingInfoNeeded()){
        var deferred = Api.defer();
        deferred.resolve();
        return deferred.promise;
      }
      var self = this,
          user = require.mozuData('user');

          var appleFulfillmentData = {};

          appleFulfillmentData.fulfillmentContact = {
              "address": {
                  "address1": appleShippingContact.addressLines[0] || "",
                  "address2": appleShippingContact.addressLines[1] || "",
                  "address3": appleShippingContact.addressLines[2] || "",
                  "address4": appleShippingContact.addressLines[3] || "",
                  "cityOrTown": appleShippingContact.locality,
                  "countryCode": appleShippingContact.countryCode.toUpperCase(),
                  "postalOrZipCode": appleShippingContact.postalCode,
                  "stateOrProvince": appleShippingContact.administrativeArea
              },
              "firstName": appleShippingContact.givenName,
              "lastNameOrSurname": appleShippingContact.familyName,
              "phoneNumbers": {
                  "home": appleShippingContact.phoneNumber
              }

          };

      if (self.multishipEnabled){
        return self.setShippingDestinations(appleFulfillmentData.fulfillmentContact);
      } else {
        var fulfillmentInfo = appleFulfillmentData;
        if (user && user.email) {
            fulfillmentInfo.fulfillmentContact.email =  user.email;
        }
        else {
            fulfillmentInfo.fulfillmentContact.email = appleShippingContact.emailAddress;
        }
        return self.orderModel.apiModel.updateShippingInfo(fulfillmentInfo,  { silent: true });
      }
    },
    setShippingDestinations: function(fulfillmentContact){
        // shipping address setter for multiship.
        var self = this;
        var destinationPayload = {
            destinationContact: fulfillmentContact
        };
        return self.orderModel.apiModel.addShippingDestination(destinationPayload).then(function(response){
            var destinationId = response.data.id;
            return self.orderModel.apiModel.setAllShippingDestinations({
              destinationId: destinationId
            });
        });

    },
    setShippingMethod: function (){
      //TODO: only do this if we haven't already selected the shipping method.
      //Be sure to return a promise regardless
      var self = this;

      if (!self.isShippingInfoNeeded()){
          var deferred = Api.defer();
          deferred.resolve();
          return deferred.promise;
      }
      return self.orderModel.apiModel.getShippingMethods(null, {silent:true}).then(
          function (methods) {

              if (methods.length === 0) {
                  self.handleError(null, Hypr.getLabel('noShippingMethods'));
              }

              if (self.multishipEnabled){
                var shippingMethods = [];

                _.each(methods, function(method) {
                    var existing = _.findWhere(self.orderModel.get('groupings'), {'id' : method.groupingId });
                    var shippingRate = null;

                    if (existing)
                        shippingRate = _.findWhere(method.shippingRates, {'shippingMethodCode': existing.shippingMethodCode});

                    if (!shippingRate)
                         shippingRate = _.min(method.shippingRates, function (rate){ return rate.price;});

                    shippingMethods.push({groupingId: method.groupingId, shippingRate: shippingRate});
                });

                return self.orderModel.apiModel.setShippingMethods({id: self.orderModel.get('id'), postdata:shippingMethods});

              } else {
              var shippingMethod = "";
              // if (existingShippingMethodCode)
              //     shippingMethod = _.findWhere(methods, {shippingMethodCode: existingShippingMethodCode});

              if (!shippingMethod || !shippingMethod.shippingMethodCode)
                  shippingMethod =_.min(methods, function(method){return method.price;});

              var fulfillmentInfo = self.orderModel.get("fulfillmentInfo");
              fulfillmentInfo.shippingMethodCode = shippingMethod.shippingMethodCode;
              fulfillmentInfo.shippingMethodName = shippingMethod.shippingMethodName;
              return self.orderModel.apiModel.updateShippingInfo(fulfillmentInfo,  { silent: true });

            }
          }
        );
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

        var requiredShippingContactFields = ["phone", "email"];
        //If we aren't on the cart, we don't need to get shipping info
        //however, for some reason, you can only get email and phone number
        //on the apple shipping contact fields - not their billing contact fields
        if (this.isShippingInfoNeeded()){
          requiredShippingContactFields.push("postalAddress");
          requiredShippingContactFields.push("name");
        }
        //toFixed returns a string. We are fine with that.

        var totalAmount;
        if (this.isCart){
            totalAmount = window.cartView.cartView.model.get('total');
        } else {
            totalAmount = window.checkoutViews.orderSummary.model.get('total');
        }
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
