define([
    'modules/jquery-mozu',
    'underscore',
    'hyprlive',
    'modules/backbone-mozu',
    'modules/api',
    'modules/models-customer',
    'modules/models-address',
    'modules/models-paymentmethods',
    'hyprlivecontext',
    'modules/checkout/model-checkout-step',
    'modules/checkout/steps/fulfillment-info',
    'modules/checkout/steps/billing-info'
],
    function ($, _, Hypr, Backbone, api, CustomerModels, AddressModels, PaymentMethods, HyprLiveContext, CheckoutStep, FulfillmentInfo, BillingInfo) {

        
        var ShopperNotes = Backbone.MozuModel.extend(),

        checkoutPageValidation = {
            'emailAddress': {
                fn: function (value) {
                    if (this.attributes.createAccount && (!value || !value.match(Backbone.Validation.patterns.email))) return Hypr.getLabel('emailMissing');
                }
            },
            'password': {
                fn: function (value) {
                    if (this.attributes.createAccount && !value) return Hypr.getLabel('passwordMissing');
                }
            },
            'confirmPassword': {
                fn: function (value) {
                    if (this.attributes.createAccount && value !== this.get('password')) return Hypr.getLabel('passwordsDoNotMatch');
                }
            }
        };

        if (Hypr.getThemeSetting('requireCheckoutAgreeToTerms')) {
            checkoutPageValidation.agreeToTerms = {
                acceptance: true,
                msg: Hypr.getLabel('didNotAgreeToTerms')
            };
        }

        var storefrontOrderAttributes = require.mozuData('pagecontext').storefrontOrderAttributes;
        if(storefrontOrderAttributes && storefrontOrderAttributes.length > 0){

            var requiredAttributes = _.filter(storefrontOrderAttributes, 
                function(attr) { return attr.isRequired && attr.isVisible && attr.valueType !== 'AdminEntered' ;  });
            requiredAttributes.forEach(function(attr) {
                if(attr.isRequired) {

                    checkoutPageValidation['orderAttribute-' + attr.attributeFQN] = 
                    {
                        required: true,
                        msg: attr.content.value + " " + Hypr.getLabel('missing')
                    };
                }
            }, this);
        }

        var CheckoutPage = Backbone.MozuModel.extend({
            mozuType: 'order',
            handlesMessages: true,
            relations: {
                fulfillmentInfo: FulfillmentInfo,
                billingInfo: BillingInfo,
                shopperNotes: ShopperNotes,
                customer: CustomerModels.Customer
            },
            validation: checkoutPageValidation,
            dataTypes: {
                createAccount: Backbone.MozuModel.DataTypes.Boolean,
                acceptsMarketing: Backbone.MozuModel.DataTypes.Boolean,
                amountRemainingForPayment: Backbone.MozuModel.DataTypes.Float
            },
            initialize: function (data) {

                var self = this,
                    user = require.mozuData('user');

                _.defer(function() {

                    var latestPayment = self.apiModel.getCurrentPayment(),
                        activePayments = self.apiModel.getActivePayments(),
                        fulfillmentInfo = self.get('fulfillmentInfo'),
                        fulfillmentContact = fulfillmentInfo.get('fulfillmentContact'),
                        billingInfo = self.get('billingInfo'),
                        steps = [fulfillmentInfo, fulfillmentContact, billingInfo],
                        paymentWorkflow = latestPayment && latestPayment.paymentWorkflow,
                        visaCheckoutPayment = activePayments && _.findWhere(activePayments, { paymentWorkflow: 'VisaCheckout' }),
                        allStepsComplete = function () {
                            return _.reduce(steps, function(m, i) { return m + i.stepStatus(); }, '') === 'completecompletecomplete';
                        },
                        isReady = allStepsComplete();

                    //Visa checkout payments can be added to order without UIs knowledge. This evaluates and voids the required payments.
                    if (visaCheckoutPayment) {
                        _.each(_.filter(self.apiModel.getActivePayments(), function (payment) {
                            return payment.paymentType !== 'StoreCredit' && payment.paymentType !== 'GiftCard' && payment.paymentWorkflow != 'VisaCheckout';
                        }), function (payment) {
                            self.apiVoidPayment(payment.id);
                        });
                        paymentWorkflow = visaCheckoutPayment.paymentWorkflow;
                        billingInfo.unset('billingContact');
                        billingInfo.set('card', visaCheckoutPayment.billingInfo.card);
                        billingInfo.set('billingContact', visaCheckoutPayment.billingInfo.billingContact, { silent:true });
                     }

                    if (paymentWorkflow) {
                        billingInfo.set('paymentWorkflow', paymentWorkflow);
                        billingInfo.get('card').set({
                            isCvvOptional: Hypr.getThemeSetting('isCvvSuppressed'),
                            paymentWorkflow: paymentWorkflow
                        });
                        billingInfo.trigger('stepstatuschange'); // trigger a rerender
                    }

                    self.isReady(isReady);

                    _.each(steps, function(step) {
                        self.listenTo(step, 'stepstatuschange', function() {
                            _.defer(function() {
                                self.isReady(allStepsComplete());
                            });
                        });
                    });

                    if (!self.get('requiresFulfillmentInfo')) {
                        self.validation = _.pick(self.constructor.prototype.validation, _.filter(_.keys(self.constructor.prototype.validation), function(k) { return k.indexOf('fulfillment') === -1; }));
                    }

                    self.get('billingInfo.billingContact').on('change:email', function(model, newVal) {
                        self.set('email', newVal);
                    });

                    var billingEmail = billingInfo.get('billingContact.email');
                    if (!billingEmail && user.email) billingInfo.set('billingContact.email', user.email);

                    self.applyAttributes();

                });
                if (user.isAuthenticated) {
                    this.set('customer', { id: user.accountId });
                }
                // preloaded JSON has this as null if it's unset, which defeats the defaults collection in backbone
                if (data.acceptsMarketing === null) {
                    self.set('acceptsMarketing', true);
                }

                _.bindAll(this, 'update', 'onCheckoutSuccess', 'onCheckoutError', 'addNewCustomer', 'saveCustomerCard', 'apiCheckout', 
                    'addDigitalCreditToCustomerAccount', 'addCustomerContact', 'addBillingContact', 'addShippingContact', 'addShippingAndBillingContact');

            },

            applyAttributes: function() {
                var storefrontOrderAttributes = require.mozuData('pagecontext').storefrontOrderAttributes;
                if(storefrontOrderAttributes && storefrontOrderAttributes.length > 0) {
                    this.set('orderAttributes', storefrontOrderAttributes);
                }
            },

            processDigitalWallet: function(digitalWalletType, payment) {
                var me = this;
                me.runForAllSteps(function() {
                    this.isLoading(true);
                });
                me.trigger('beforerefresh');
                // void active payments; if there are none then the promise will resolve immediately
                return api.all.apply(api, _.map(_.filter(me.apiModel.getActivePayments(), function(payment) {
                    return payment.paymentType !== 'StoreCredit' && payment.paymentType !== 'GiftCard';
                }), function(payment) {
                    return me.apiVoidPayment(payment.id);
                })).then(function() {
                    return me.apiProcessDigitalWallet({
                        digitalWalletData: JSON.stringify(payment)
                    }).then(function () {
                        me.updateVisaCheckoutBillingInfo();
                        me.runForAllSteps(function() {
                            this.trigger('sync');
                            this.isLoading(false);
                        });
                        me.updateShippingInfo();
                    });
                });
            },
            updateShippingInfo: function() {
                var me = this;
                this.apiModel.getShippingMethods().then(function (methods) { 
                    me.get('fulfillmentInfo').refreshShippingMethods(methods);
                });
            },
            updateVisaCheckoutBillingInfo: function() {
                //Update the billing info with visa checkout payment
                var billingInfo = this.get('billingInfo');
                var activePayments = this.apiModel.getActivePayments();
                var visaCheckoutPayment = activePayments && _.findWhere(activePayments, { paymentWorkflow: 'VisaCheckout' });
                if (visaCheckoutPayment) {
                    billingInfo.set('usingSavedCard', false);
                    billingInfo.unset('savedPaymentMethodId');
                    billingInfo.set('card', visaCheckoutPayment.billingInfo.card);
                    billingInfo.unset('billingContact');
                    billingInfo.set('billingContact', visaCheckoutPayment.billingInfo.billingContact, { silent:true });
                    billingInfo.set('paymentWorkflow', visaCheckoutPayment.paymentWorkflow);
                    billingInfo.set('paymentType', visaCheckoutPayment.paymentType);
                    this.refresh();
                }
            },
            addCoupon: function () {
                var me = this;
                var code = this.get('couponCode');
                var orderDiscounts = me.get('orderDiscounts');
                if (orderDiscounts && _.findWhere(orderDiscounts, { couponCode: code })) {
                    // to maintain promise api
                    var deferred = api.defer();
                    deferred.reject();
                    deferred.promise.otherwise(function () {
                        me.trigger('error', {
                            message: Hypr.getLabel('promoCodeAlreadyUsed', code)
                        });
                    });
                    return deferred.promise;
                }
                this.isLoading(true);
                return this.apiAddCoupon(this.get('couponCode')).then(function () {

                    me.get('billingInfo').trigger('sync');
                    me.set('couponCode', '');

                    var productDiscounts = _.flatten(_.pluck(me.get('items'), 'productDiscounts'));
                    var shippingDiscounts = _.flatten(_.pluck(_.flatten(_.pluck(me.get('items'), 'shippingDiscounts')), 'discount'));
                    var orderShippingDiscounts = _.flatten(_.pluck(me.get('shippingDiscounts'), 'discount'));

                    var allDiscounts = me.get('orderDiscounts').concat(productDiscounts).concat(shippingDiscounts).concat(orderShippingDiscounts);
                    var lowerCode = code.toLowerCase();

                    var matchesCode = function (d) {
                        // there are discounts that have no coupon code that we should not blow up on.
                        return (d.couponCode || "").toLowerCase() === lowerCode;
                    };

                    if (!allDiscounts || !_.find(allDiscounts, matchesCode))
                    {
                        me.trigger('error', {
                            message: Hypr.getLabel('promoCodeError', code)
                        });
                    }

                    else if (me.get('total') === 0) {
                        me.trigger('complete');
                    }
                    // only do this when there isn't a payment on the order...
                    me.get('billingInfo').updatePurchaseOrderAmount();
                    me.isLoading(false);
                });
            },
            onCheckoutSuccess: function () {
                this.isLoading(true);
                this.trigger('complete');
            },
            onCheckoutError: function (error) {
                var order = this,
                    errorHandled = false;
                order.isLoading(false);
                if (!error || !error.items || error.items.length === 0) {
                    error = {
                        items: [
                            {
                                message: error.message || Hypr.getLabel('unknownError')
                            }
                        ]
                    };
                }
                $.each(error.items, function (ix, errorItem) {
                    if (errorItem.name === 'ADD_CUSTOMER_FAILED' && errorItem.message.toLowerCase().indexOf('invalid parameter: password')) {
                        errorHandled = true;
                        order.trigger('passwordinvalid', errorItem.message.substring(errorItem.message.indexOf('Password')));
                    }
                    if (errorItem.errorCode === 'ADD_CUSTOMER_FAILED' && errorItem.message.toLowerCase().indexOf('invalid parameter: emailaddress')) {
                        errorHandled = true;
                        order.trigger('userexists', order.get('emailAddress'));
                    }
                });

                this.trigger('error', error);

                if (!errorHandled) order.messages.reset(error.items);
                order.isSubmitting = false;
                throw error;
            },
            addNewCustomer: function () {
                var self = this,
                billingInfo = this.get('billingInfo'),
                billingContact = billingInfo.get('billingContact'),
                email = this.get('emailAddress'),
                captureCustomer = function (customer) {
                    if (!customer || (customer.type !== 'customer' && customer.type !== 'login')) return;
                    var newCustomer;
                    if (customer.type === 'customer') newCustomer = customer.data;
                    if (customer.type === 'login') newCustomer = customer.data.customerAccount;
                    if (newCustomer && newCustomer.id) {
                        self.set('customer', newCustomer);
                        api.off('sync', captureCustomer);
                        api.off('spawn', captureCustomer);
                    }
                };
                api.on('sync', captureCustomer);
                api.on('spawn', captureCustomer);
                return this.apiAddNewCustomer({
                    account: {
                        emailAddress: email,
                        userName: email,
                        firstName: billingContact.get('firstName') || this.get('fulfillmentInfo.fulfillmentContact.firstName'),
                        lastName: billingContact.get('lastNameOrSurname') || this.get('fulfillmentInfo.fulfillmentContact.lastNameOrSurname'),
                        acceptsMarketing: self.get('acceptsMarketing')
                    },
                    password: this.get('password')
                }).then(function (customer) {
                    self.customerCreated = true;
                    return customer;
                }, function (error) {
                    self.customerCreated = false;
                    self.isSubmitting = false;
                    throw error;
                });
            },
            addBillingContact: function () {
                return this.addCustomerContact('billingInfo', 'billingContact', [{ name: 'Billing' }]);
            },
            addShippingContact: function () {
                return this.addCustomerContact('fulfillmentInfo', 'fulfillmentContact', [{ name: 'Shipping' }]);
            },
            addShippingAndBillingContact: function () {
                return this.addCustomerContact('fulfillmentInfo', 'fulfillmentContact', [{ name: 'Shipping' }, { name: 'Billing' }]);
            },
            addCustomerContact: function (infoName, contactName, contactTypes) {
                var customer = this.get('customer'),
                    contactInfo = this.get(infoName),
                    process = [function () {
                      
                        // Update contact if a valid contact ID exists
                        if (orderContact.id && orderContact.id > 0) {
                            return customer.apiModel.updateContact(orderContact);
                        }

                        if (orderContact.id === -1 || orderContact.id === 1 || orderContact.id === 'new') {
                            delete orderContact.id;
                        }
                        return customer.apiModel.addContact(orderContact).then(function(contactResult) {
                                orderContact.id = contactResult.data.id;
                                return contactResult;
                            });
                    }];
                var contactInfoContactName = contactInfo.get(contactName);
                var customerContacts = customer.get('contacts');
                    
                if (!contactInfoContactName.get('accountId')) {
                    contactInfoContactName.set('accountId', customer.id);
                }
                var orderContact = contactInfoContactName.toJSON();
                // if customer doesn't have a primary of any of the contact types we're setting, then set primary for those types
                if (!this.isSavingNewCustomer()) {
                    process.unshift(function() {
                        return customer.apiModel.getContacts().then(function(contacts) {
                            _.each(contactTypes, function(newType) {
                                var primaryExistsAlready = _.find(contacts.data.items, function(existingContact) {
                                    return _.find(existingContact.types || [], function(existingContactType) {
                                        return existingContactType.name === newType.name && existingContactType.isPrimary;
                                    });
                                });
                                newType.isPrimary = !primaryExistsAlready;
                            });
                        });
                    });
                } else {
                    _.each(contactTypes, function(type) {
                        type.isPrimary = true;
                    });
                }

                // handle email
                if (!orderContact.email) orderContact.email = this.get('emailAddress') || customer.get('emailAddress') || require.mozuData('user').email;

                var contactId = orderContact.contactId;
                if (contactId) orderContact.id = contactId;
                if (!orderContact.id || orderContact.id === -1 || orderContact.id === 1 || orderContact.id === 'new') {
                    orderContact.types = contactTypes;
                    return api.steps(process);
                } else {
                    var customerContact = customerContacts.get(orderContact.id).toJSON();
                    if (this.isContactModified(orderContact, customerContact)) {
                        //keep the current types on edit
                        orderContact.types = orderContact.types ? orderContact.types : customerContact.types;
                        return api.steps(process);
                    } else {
                        var deferred = api.defer();
                        deferred.resolve();
                        return deferred.promise;
                    }
                }
            },
            isContactModified: function(orderContact, customerContact) {
                var validContact = orderContact && customerContact && orderContact.id === customerContact.id;
                var addressChanged = validContact && !_.isEqual(orderContact.address, customerContact.address);
                //Note: Only home phone is used on the checkout page     
                var phoneChanged = validContact && orderContact.phoneNumbers.home &&
                                    (!customerContact.phoneNumbers.home || orderContact.phoneNumbers.home !== customerContact.phoneNumbers.home);

                //Check whether any of the fields available in the contact UI on checkout page is modified
                return validContact &&
                    (addressChanged || phoneChanged || 
                    orderContact.email !== customerContact.email || orderContact.firstName !== customerContact.firstName ||
                    orderContact.lastNameOrSurname !== customerContact.lastNameOrSurname);
            },
            saveCustomerCard: function () {
                var order = this,
                    customer = this.get('customer'), //new CustomerModels.EditableCustomer(this.get('customer').toJSON()),
                    billingInfo = this.get('billingInfo'),
                    isSameBillingShippingAddress = billingInfo.get('isSameBillingShippingAddress'),
                    isPrimaryAddress = this.isSavingNewCustomer(),
                    billingContact = billingInfo.get('billingContact').toJSON(),
                    card = billingInfo.get('card'),
                    doSaveCard = function() {
                        order.cardsSaved = order.cardsSaved || customer.get('cards').reduce(function(saved, card) {
                            saved[card.id] = true;
                            return saved;
                        }, {});
                        var method = order.cardsSaved[card.get('id') || card.get('paymentServiceCardId')] ? 'updateCard' : 'addCard';
                        card.set('contactId', billingContact.id);
                        return customer.apiModel[method](card.toJSON()).then(function(card) {
                            order.cardsSaved[card.data.id] = true;
                            return card;
                        });
                    };

                var contactId = billingContact.contactId;
                if (contactId) billingContact.id = contactId;

                if (!billingContact.id || billingContact.id === -1 || billingContact.id === 1 || billingContact.id === 'new') {
                    billingContact.types = !isSameBillingShippingAddress ? [{ name: 'Billing', isPrimary: isPrimaryAddress }] : [{ name: 'Shipping', isPrimary: isPrimaryAddress }, { name: 'Billing', isPrimary: isPrimaryAddress }];
                    return this.addCustomerContact('billingInfo', 'billingContact', billingContact.types).then(function (contact) {
                        billingContact.id = contact.data.id;
                        return contact;
                    }).then(doSaveCard);
                } else {
                    return doSaveCard();
                }
            },
            setFulfillmentContactEmail: function () {
                var fulfillmentEmail = this.get('fulfillmentInfo.fulfillmentContact.email'),
                    orderEmail = this.get('email');

                if (!fulfillmentEmail) {
                    this.set('fulfillmentInfo.fulfillmentContact.email', orderEmail);
                }
            },
            syncBillingAndCustomerEmail: function () {
                var billingEmail = this.get('billingInfo.billingContact.email'),
                    customerEmail = this.get('emailAddress') || require.mozuData('user').email;
                if (!customerEmail) {
                    this.set('emailAddress', billingEmail);
                }
                if (!billingEmail) {
                    this.set('billingInfo.billingContact.email', customerEmail);
                }
            },
            addDigitalCreditToCustomerAccount: function () {
                var billingInfo = this.get('billingInfo'),
                    customer = this.get('customer');

                var digitalCredits = billingInfo.getDigitalCreditsToAddToCustomerAccount();
                if (!digitalCredits)
                    return;
                return _.each(digitalCredits, function (cred) {
                    return customer.apiAddStoreCredit(cred.get('code'));
                });
            },
            isSavingNewCustomer: function() {
                return this.get('createAccount') && !this.customerCreated;
            },

            validateReviewCheckoutFields: function(){
                var validationResults = [];
                for (var field in checkoutPageValidation) {
                    if(checkoutPageValidation.hasOwnProperty(field)) {
                        var result = this.validate(field);
                        if(result) {
                            validationResults.push(result);
                        }
                    }
                }

                return validationResults.length > 0;
            },

            submit: function () {
                var order = this,
                    billingInfo = this.get('billingInfo'),
                    billingContact = billingInfo.get('billingContact'),
                    isSameBillingShippingAddress = billingInfo.get('isSameBillingShippingAddress'),
                    isSavingCreditCard = false,
                    isSavingNewCustomer = this.isSavingNewCustomer(),
                    isAuthenticated = require.mozuData('user').isAuthenticated,
                    nonStoreCreditTotal = billingInfo.nonStoreCreditTotal(),
                    requiresFulfillmentInfo = this.get('requiresFulfillmentInfo'),
                    requiresBillingInfo = nonStoreCreditTotal > 0,
                    process = [function() {
                        return order.update({
                            ipAddress: order.get('ipAddress'),
                            shopperNotes: order.get('shopperNotes').toJSON()
                        });
                    }];

                var storefrontOrderAttributes = require.mozuData('pagecontext').storefrontOrderAttributes;
                if(storefrontOrderAttributes && storefrontOrderAttributes.length > 0) {
                    var updateAttrs = [];
                    storefrontOrderAttributes.forEach(function(attr){
                        var attrVal = order.get('orderAttribute-' + attr.attributeFQN);
                        if(attrVal) {
                            updateAttrs.push({
                                'fullyQualifiedName': attr.attributeFQN,
                                'values': [ attrVal ]
                            });
                        }
                    });

                    if(updateAttrs.length > 0){
                        process.push(function(){
                            return order.apiUpdateAttributes(updateAttrs);
                        }, function() {
                            return order.apiGet();
                        });
                    }
                }

                if (this.isSubmitting) return;

                this.isSubmitting = true;

                if (requiresBillingInfo && !billingContact.isValid()) {
                    // reconcile the empty address after we got back from paypal and possibly other situations.
                    // also happens with visacheckout ..
                    var billingInfoFromPayment = (this.apiModel.getCurrentPayment() || {}).billingInfo;
                    billingInfo.set(billingInfoFromPayment, { silent: true });
                }

                this.syncBillingAndCustomerEmail();
                this.setFulfillmentContactEmail();

                // skip payment validation, if there are no payments, but run the attributes and accept terms validation.
                if ((nonStoreCreditTotal > 0 && this.validate()) || this.validateReviewCheckoutFields()) {
                    this.isSubmitting = false;
                    return false;
                } 

                this.isLoading(true);

                if (isSavingNewCustomer) {
                    process.unshift(this.addNewCustomer); 
                }

                var activePayments = this.apiModel.getActivePayments();
                var saveCreditCard = false;
                if (activePayments !== null && activePayments.length > 0) {
                     var creditCard = _.findWhere(activePayments, { paymentType: 'CreditCard' });
                     if (creditCard && creditCard.billingInfo && creditCard.billingInfo.card) {
                         saveCreditCard = creditCard.billingInfo.card.isCardInfoSaved;
                         billingInfo.set('card', creditCard.billingInfo.card);
                     }
                 }
                 if (saveCreditCard && (this.get('createAccount') || isAuthenticated)) {
                    isSavingCreditCard = true;
                    process.push(this.saveCustomerCard);
                    }

                if ((this.get('createAccount') || isAuthenticated) && billingInfo.getDigitalCreditsToAddToCustomerAccount().length > 0) {
                    process.push(this.addDigitalCreditToCustomerAccount);
                }

                //save contacts
                if (isAuthenticated || isSavingNewCustomer) {
                    if (!isSameBillingShippingAddress && !isSavingCreditCard) {
                        if (requiresFulfillmentInfo) process.push(this.addShippingContact);
                        if (requiresBillingInfo) process.push(this.addBillingContact);
                    } else if (isSameBillingShippingAddress && !isSavingCreditCard) {
                        process.push(this.addShippingAndBillingContact);
                    } else if (!isSameBillingShippingAddress && isSavingCreditCard && requiresFulfillmentInfo) {
                        process.push(this.addShippingContact);
                    }
                }
               
                process.push(/*this.finalPaymentReconcile, */this.apiCheckout);
                
                api.steps(process).then(this.onCheckoutSuccess, this.onCheckoutError);

            },
            update: function() {
                var j = this.toJSON();
                return this.apiModel.update(j);
            },
            refresh: function() {
              var me = this;
              this.trigger('beforerefresh');
              return this.apiGet().then(function() {
                me.trigger('refresh');
                // me.runForAllSteps(function() {
                //   this.trigger("sync");
                // });
              });
            },
            runForAllSteps: function(cb) {
                var me = this;
                _.each([
                       'fulfillmentInfo.fulfillmentContact',
                       'fulfillmentInfo',
                       'billingInfo'
                ], function(name) {
                    cb.call(me.get(name));
                });
            },
            isReady: function (val) {
                this.set('isReady', val);
            },
            toJSON: function (options) {
                var j = Backbone.MozuModel.prototype.toJSON.apply(this, arguments);
                if (!options || !options.helpers) {
                    delete j.password;
                    delete j.confirmPassword;
                }
                return j;
            }
        });

        return {
            CheckoutPage: CheckoutPage
        };
    }
);
