define(['modules/jquery-mozu', 'hyprlive' ,"modules/api",'hyprlivecontext','underscore', "modules/backbone-mozu", 'modules/models-cart', 'modules/checkout/models-checkout-page', 'modules/models-checkout'
],
function($, Hypr, Api, hyprlivecontext, _, Backbone, CartModels, CheckoutModels, OrderModels) {
  var apiContext = require.mozuData('apicontext');
  var ApplePaySession = window.ApplePaySession;
  var ApplePayToken = Backbone.MozuModel.extend({
      mozuType: 'token',
      defaults: {
        //this needs to be camel case for the session fetch.
        //for the token fetch, we toUpperCase() it in the sdk.
        'type': 'ApplePay'
      },
      getSessionPayload: function(){
        var self = this;
        var body = { domain: self.get('domain'), storeName: self.get('storeName') };
        var payload = {cardType: self.get('type'), methodName: "Session", body: body };
        return payload;
      }
  });
  var ApplePayCheckout = Backbone.MozuModel.extend({ mozuType: 'checkout'});
  var ApplePayOrder = Backbone.MozuModel.extend({ mozuType: 'order' });
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
              self.orderModel = orderModel;
              var request = self.buildRequest();
              self.applePayToken = new ApplePayToken();

              // define our ApplePay Session with the version number.
              // then we define a set of handlers.
              // after our session object knows how to respond to apple's various events,
              // we call begin(). The merchant is then validated, initializing
              // the 'true' session.

              self.session = new ApplePaySession(3, request);

              // set handlers. These all get called by apple.
              self.session.onvalidatemerchant = function(event){
                  var validationURL = event.validationURL;

                  self.applePayToken.set('domain', window.location.hostname);
                  self.applePayToken.set('storeName', self.storeName);
                  var payload = self.applePayToken.getSessionPayload();
                  self.applePayToken.apiExecute(payload).then(function(response){
                    //console.log(response);
                    self.session.completeMerchantValidation(response);
                  }, function(error){
                      //TODO: make sure api handles and returns this error appropriately
                      //console.log(error);
                  });
              };


              self.session.onpaymentmethodselected = function(event){
                  //console.log(event);
                  //TODO: we should use this time to set some aspect of the order
                  // to applepay and update it so we can receive any apple pay related
                  // discounts.

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
                  //takes an ApplePayShippingContactUpdate object
                  //errors [String]
                  //newLineItems (optional)
                  //newShippingMethods (optional?)
                  //newTotal (required - has label, amount, and type strings)

                  //TODO:Apple expects an update to the price at this point.
                  //We should investigate what would cause that.
                  //We also need to pass an error object if there is a problem.

                  //TODO: confirm this value is the same for multiship;
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

                //first assign new billingcontact to ordermodel
                var amount = self.orderModel.get('amountRemainingForPayment');
                self.session.completeBillingContactSelection({
                  newTotal: {
                    "label": self.storeName,
                    "amount": amount+"",
                    "type": "final"
                  },
                  newLineItems: []
                });
              };

              //This handler gets called after the user authorizes the wallet payment
              //on their phone. This is when we receive the payment token from apple.
              self.session.onpaymentauthorized = function(event) {
                var status = 0;
                self.applePayToken.set('tokenObject', event.payment.token);
                self.applePayToken.apiCreate().then(function(response){
                  if (!response.isSuccessful){
                    //TODO: Need to know how errors are going to come through.
                    // We have to set the status of the authorization manually.
                    // We'll be getting information from the event object and/or the  if there is a problem
                    // so we need to figure out what that will look like and how to handle it.

                  } else {
                    var appleBillingContact = event.payment.billingContact;
                    var appleShippingContact = event.payment.shippingContact;
                    var billingEmail = appleShippingContact.emailAddress;
                    //TODO: use user email if they're logged in maybe?
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
                              type: 'APPLEPAY'
                          }

                      }
                    };

                        // TODO: update status number if there's an issue with create payment
                        self.orderModel.apiCreatePayment(payload).then(function(order){
                          self.orderModel.set(order.data);
                          self.setShippingContact(appleShippingContact).then(function(shippingContactResponse){
                            if (shippingContactResponse.data) self.orderModel.set('fulfillmentInfo', shippingContactResponse.data);
                            self.setShippingMethod().then(function(shippingMethodResponse){
                                self.orderModel.set(shippingMethodResponse.data);
                                self.session.completePayment({"status": status});
                                var id = self.orderModel.get('id');
                                var redirectUrl = hyprlivecontext.locals.pageContext.secureHost;
                                var checkoutUrl = self.multishipEnabled ? "/checkoutv2" : "/checkout";
                                redirectUrl += checkoutUrl + '/' + id;
                                window.location.href = redirectUrl;
                          }, function(shippingMethodError){
                              //TODO: error handling
                          });
                        });
                    }, function(createPaymentError){
                        //TODO: error handling
                    });

                  }
                });


              };
              self.session.oncancel = function(event){
                //TODO:
                /*
                Do we need to delete the floating order? any other cleanup?
                */
              };
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
                    //return responseData;
                    return new ApplePayCheckout(responseData.data);
                }, function(error){
                  ////console.log(error);
                });
            } else {
                return this.cart.apiCheckout().then(function(responseData){
                    //return responseData;
                    return new ApplePayOrder(responseData.data);
                });
            }
        } else {
          var deferred = Api.defer();
            if (this.multishipEnabled){
                deferred.resolve(new ApplePayCheckout(window.checkout));
                return deferred.promise;
            } else {
                deferred.resolve(new ApplePayCheckout(window.order));
                return deferred.promise;
            }
        }
    },
    setShippingContact: function(appleShippingContact){
      if (!this.isCart){
        var deferred = Api.defer();
        deferred.resolve();
        return deferred.promise;
      }
      var self = this,
          user = require.mozuData('user');

          var appleFulfillmentData = {};

          //TODO: make this clone work
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
      /*
      add destination - POST  commerce/checkouts/checkoutId/destinations
      Bulk Update Item Destinations
      */
        var self = this;
        var destinationPayload = {
              destinationContact: fulfillmentContact
        };
        var itemIds = self.getItemIds();
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
      return self.orderModel.apiModel.getShippingMethods(null, {silent:true}).then(
          function (methods) {

              if (methods.length === 0) {
                  self.orderModel.onCheckoutError(Hypr.getLabel("noShippingMethods"));
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

                return self.orderModel.apiModel.setShippingMethods({id: self.orderModel.get('id'), postdata:shippingMethods})/*.then(function(result) {
                    // me.applyBilling();
                })*/;

              } else {
              var shippingMethod = "";
              // if (existingShippingMethodCode)
              //     shippingMethod = _.findWhere(methods, {shippingMethodCode: existingShippingMethodCode});

              if (!shippingMethod || !shippingMethod.shippingMethodCode)
                  shippingMethod =_.min(methods, function(method){return method.price;});

              var fulfillmentInfo = self.orderModel.get("fulfillmentInfo");
              fulfillmentInfo.shippingMethodCode = shippingMethod.shippingMethodCode;
              fulfillmentInfo.shippingMethodName = shippingMethod.shippingMethodName;

              ////console.log(self.orderModel.get('fulfillmentInfo'));
              return self.orderModel.apiModel.updateShippingInfo(fulfillmentInfo,  { silent: true });
              // .then(
              //     function() {
              //         self.orderModel.set("fulfillmentInfo", fulfillmentInfo);
              //     });
            }
          });
    },
    getItemIds: function(){
      var self = this;
      var ids = [];
      self.orderModel.get('items').forEach(function(item){
          ids.push(item.id);
      });
      return ids;
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
        var totalAmount = "";
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
          //TODO: total should be set with the checkout or order info.
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
