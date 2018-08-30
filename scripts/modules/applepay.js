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

  var ApplePayCheckout = Backbone.MozuModel.extend({
      mozuType: 'checkout'
  });

  var ApplePayOrder = Backbone.MozuModel.extend({
      mozuType: 'order'
  })
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
              self.applePayToken = new ApplePayToken();

              // define our ApplePay Session with the version number
              self.session = new ApplePaySession(3, request);

              // set handlers. These all get called by apple.
              self.session.onvalidatemerchant = function(event){
                  var validationURL = event.validationURL;

                  self.applePayToken.set('domain', window.location.hostname);
                  self.applePayToken.set('storeName', self.storeName);
                  self.applePayToken.apiGetSession().then(function(response){
                    console.log(response);
                    self.session.completeMerchantValidation(response);
                  }, function(error){
                      //TODO: make sure api handles and returns this error appropriately
                      console.log(error);
                  });
              };


              self.session.onpaymentmethodselected = function(event){
                  console.log(event);
                  //TODO: we should use this time to set some aspect of the order
                  // to applepay and update it so we can receive any apple pay related
                  // discounts.
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

                  //get the contact from the event?
                  console.log('shipping contact selected');
                  console.log(event);
                  //first assign the shipping contact to the orderModel
                  // then assign the cheapest shipping method
                  // then...


                  //TODO: confirm this value is the same for multiship;
                  var amount = self.orderModel.get('amountRemainingForPayment');
                  self.session.completeShippingContactSelection({
                    newTotal: {
                      "label": "Kibo (shipping contact selected)",
                      "amount": amount,
                      "type": "final"
                    },
                    newLineItems: []
                  });
              };
              self.session.onbillingcontactselected = function(event){

                //first assign new billingcontact to ordermodel

                self.session.completeBillingContactSelection({
                  newTotal: {
                    "label": "Kibo (billing contact selected)",
                    "amount": "11.00",
                    "type": "final"
                  },
                  newLineItems: []
                });
              };
              self.session.onpaymentauthorized = function(event) {
                //event holds onto the payment token.
                var status = 0;
                self.applePayToken.set('tokenObject', event.payment.token);
                self.applePayToken.apiCreate().then(function(response){
                  if (!response.isSuccessful){
                    //TODO: Need to know how errors are going to come through.
                    // We have to set the status of the authorization manually.
                    // We'll be getting information from the event object and/or the  if there is a problem
                    // so we need to figure out what that will look like and how to handle it.

                  } else {
                    var newPayment = {
                        paymentType: 'token',
                        billingInfo: {
                            paymentToken: {
                                id: 'id from create token call',
                                type: 'APPLEPAY',
                            }
                        }
                    };

                    self.orderModel.apiCreatePayment(newPayment).then(function(response){
                        // TODO: update status number if there's an issue with create payment
                        self.setShippingContact().then(function(shippingContactResponse){
                            self.setShippingMethod().then(function(shippingMethodResponse){
                              self.setBillingContact().then(function(billingContactResponse){
                                  self.session.completePayment({"status": status});
                                  var id = this.orderModel.get('id');
                                  var redirectUrl = hyprlivecontext.locals.pageContext.secureHost;
                                  var checkoutUrl = self.multishipEnabled ? "/checkoutv2" : "/checkout";
                                  redirectURL += checkoutUrl + '/' + id;
                              });
                            });
                        });

                        self.session.completePayment({"status": status});
                        // TODO: redirect to checkout page here.

                    });
                  }
                });


              };
              self.session.oncancel = function(event){
                //TODO:
                /*
                Do we need to delete the floating order? any other cleanup?
                */
              }
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
                    return new ApplePayCheckout(responseData);
                });
            } else {
                return this.cart.apiCheckout().then(function(responseData){
                    //return responseData;
                    return new ApplePayOrder(responseData);
                });
            }
        } else {
            // TODO: We're in checkout, we can get the current checkout or order object.
            // Still needs to be returned as a Promise.
        }
    },
    setShippingContact: function(event){
      if (!this.isCart){
        return Promise.resolve('no shipping contact needed');
      }

      console.log(this.applePayToken);
      var self = this,
          fulfillmentInfo = self.orderModel.get("fulfillmentInfo"),
          existingShippingMethodCode = fulfillmentInfo.shippingMethodCode,
          user = require.mozuData('user');

      var appleFulfillmentData = {};

          //TODO: make this clone work
          appleFulfillmentData = fulfillmentInfo.clone();
          appleFulfillmentData.fulfillmentContact = {
              "address": "address from event, etc"
          }

      var appleEmail = "fromapple@me.com";

      if (self.isMultishipEnabled){
        return self.setShippingDestinations();
      } else {

        if (appleFulfillmentData === null)
            appleFulfillmentData = fulfillmentInfo.data;
        else
            fulfillmentInfo.data = appleFulfillmentData;
            if (user && user.email) {
                if (!fulfillmentInfo.fulfillmentContact)
                    fulfillmentInfo.fulfillmentContact = {};

                fulfillmentInfo.fulfillmentContact.email =  user.email;
            }
            else {
                fulfillmentInfo.fulfillmentContact.email = appleEmail;
            }

            //TODO: update with api

      }
    },
    setShippingDestinations: function(orderModel){
      /*
      add destination - POST  commerce/checkouts/checkoutId/destinations
      Bulk Update Item Destinations
      */


        var tokenObject = self.applePayToken.get('tokenObject');
        console.log(tokenObject);
    },
    setShippingMethod: function (orderModel, existingShippingMethodCode){
      //TODO: only do this if we haven't already selected the shipping method

      var self = this;
      orderModel.apiModel.getShippingMethods(null, {silent:true}).then(
          function (methods) {

              if (methods.length === 0) {
                  orderModel.onCheckoutError(Hypr.getLabel("noShippingMethods"));
              }

              if (self.multishipEnabled){
                var shippingMethods = [];

                _.each(methods, function(method) {
                    var existing = _.findWhere(orderModel.get('groupings'), {'id' : method.groupingId });
                    var shippingRate = null;

                    if (existing)
                        shippingRate = _.findWhere(method.shippingRates, {'shippingMethodCode': existing.shippingMethodCode});

                    if (!shippingRate)
                         shippingRate = _.min(method.shippingRates, function (rate){ return rate.price;});

                    shippingMethods.push({groupingId: method.groupingId, shippingRate: shippingRate});
                });

                orderModel.apiModel.setShippingMethods({id: orderModel.get('id'), postdata:shippingMethods})/*.then(function(result) {
                    // me.applyBilling();
                })*/;

              } else {
              var shippingMethod = "";
              if (existingShippingMethodCode)
                  shippingMethod = _.findWhere(methods, {shippingMethodCode: existingShippingMethodCode});

              if (!shippingMethod || !shippingMethod.shippingMethodCode)
                  shippingMethod =_.min(methods, function(method){return method.price;});

              var fulfillmentInfo = orderModel.get("fulfillmentInfo");
              fulfillmentInfo.shippingMethodCode = shippingMethod.shippingMethodCode;
              fulfillmentInfo.shippingMethodName = shippingMethod.shippingMethodName;


              orderModel.apiModel.update({ fulfillmentInfo: fulfillmentInfo}, {silent: true}).then(
                  function() {
                      orderModel.set("fulfillmentInfo", fulfillmentInfo);
                  });
            }
          });
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
