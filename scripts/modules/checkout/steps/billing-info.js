define([
    'modules/jquery-mozu',
    'underscore',
    'hyprlive',
    'modules/backbone-mozu',
    'modules/api',
    'modules/models-customer',
    'modules/models-paymentmethods',
    'hyprlivecontext',
    'modules/checkout/payments/digital-credits',
    'modules/checkout/payments/purchase-order',
    'modules/checkout/model-checkout-step',
    'modules/checkout/thirdpartypayments/third-party-payments'
],
function ($, _, Hypr, Backbone, api, CustomerModels, PaymentMethods, HyprLiveContext, DigitalCredits, PurchaseOrder, CheckoutStep, ThirdPartyPayments) {

var BillingInfo = CheckoutStep.extend({
        mozuType: 'payment',
        validation: {
            paymentType: {
                fn: "validatePaymentType"
            },
            savedPaymentMethodId: {
                fn: "validateSavedPaymentMethodId"
            },

            'billingContact.email': {
                pattern: 'email',
                msg: Hypr.getLabel('emailMissing')
            }
        },
        dataTypes: {
            'isSameBillingShippingAddress': Backbone.MozuModel.DataTypes.Boolean,
            'creditAmountToApply': Backbone.MozuModel.DataTypes.Float
        },
        relations: {
            billingContact: CustomerModels.Contact,
            card: PaymentMethods.CreditCardWithCVV,
            check: PaymentMethods.Check,
            purchaseOrder: PurchaseOrder 
        },
        extendModelWith : {
            digitalCredits: DigitalCredits
        },
        helpers: ['acceptsMarketing', 'savedPaymentMethods', 'activePayments', 'hasSavedCardPayment', 'nonStoreCreditTotal', 
        'isAnonymousShopper'],
        validatePaymentType: function(value, attr) {
            var order = this.getOrder();
            var payment = order.apiModel.getCurrentPayment();
            var errorMessage = Hypr.getLabel('paymentTypeMissing');
            if (!value) return errorMessage;
            if ((value === "StoreCredit" || value === "GiftCard") && this.nonStoreCreditTotal() > 0 && !payment) return errorMessage;
        },
        validateSavedPaymentMethodId: function (value, attr, computedState) {
            if (this.get('usingSavedCard')) {
                var isValid = this.get('savedPaymentMethodId');
                if (!isValid) return Hypr.getLabel('selectASavedCard');
            }
        },
        activeStoreCredits: function () {
            var active = this.getOrder().apiModel.getActiveStoreCredits();
            return active && active.length > 0 && active;
        },
        nonStoreCreditTotal: function () {
            var me = this,
                order = this.getOrder(),
                total = order.get('total'),
                result,
                activeCredits = this.activeStoreCredits();
            if (!activeCredits) return total;
            result = total - _.reduce(activeCredits, function (sum, credit) {
                return sum + credit.amountRequested;
            }, 0);
            return me.roundToPlaces(result, 2);
        },
        acceptsMarketing: function () {
            return this.getOrder().get('acceptsMarketing');
        },
        activePayments: function () {
            return this.getOrder().apiModel.getActivePayments();
        },
        hasSavedCardPayment: function() {
            var currentPayment = this.getOrder().apiModel.getCurrentPayment();
            return !!(currentPayment && currentPayment.billingInfo.card && currentPayment.billingInfo.card.paymentServiceCardId);
        },
        resetAddressDefaults: function () {
            var billingAddress = this.get('billingContact').get('address');
            var addressDefaults = billingAddress.defaults;
            billingAddress.set('countryCode', addressDefaults.countryCode);
            billingAddress.set('addressType', addressDefaults.addressType);
            billingAddress.set('candidateValidatedAddresses', addressDefaults.candidateValidatedAddresses);
        },
        savedPaymentMethods: function () {
            var cards = this.getOrder().get('customer').get('cards').toJSON();
            return cards && cards.length > 0 && cards;
        },
        deferredError: function deferredError(msg, scope) {
            scope.trigger('error', {
                message: msg
            });
            var deferred = api.defer();
            deferred.reject();

            return deferred.promise;
        },
        areNumbersEqual: function(f1, f2) {
            var epsilon = 0.01; 
            return (Math.abs(f1 - f2)) < epsilon; 
        },
        roundToPlaces: function(amt, numberOfDecimalPlaces) {
            var transmogrifier = Math.pow(10, numberOfDecimalPlaces);
            return Math.round(amt * transmogrifier) / transmogrifier;
        },
        /**
         * Used to add remaber of shopper entered deigital credit to the user's account
         * @param {string}  creditCode  
         * @param {Boolean} isEnabled  Is code an active digital credit
         */
        addRemainingCreditToCustomerAccount: function(creditCode, isEnabled) {
            var self = this;

            var digitalCredit = self._cachedDigitalCredits.find(function(credit) {
                return credit.code.toLowerCase() === creditCode.toLowerCase();
            });

            if (!digitalCredit) {
                return self.deferredError(Hypr.getLabel('genericNotFound'), self);
            }
            digitalCredit.set('addRemainderToCustomer', isEnabled);
            return digitalCredit;
        },

        // getDigitalCreditsToAddToCustomerAccount: function() {
        //     return this._cachedDigitalCredits.where({ isEnabled: true, addRemainderToCustomer: true, isTiedToCustomer: false });
        // },

        isAnonymousShopper: function() {
            var order = this.getOrder(),
                customer = order.get('customer');
            return (!customer || !customer.id || customer.id <= 1);
        },
        syncPaymentMethod: function (me, newId) {
            if (!newId || newId === 'new') {
                me.get('card').clear();
                me.get('check').clear();
                me.unset('paymentType');
                me.clearBillingContact();
            } else {
                me.setSavedPaymentMethod(newId);
                //Maybe, setSavedPAymentMEdtod below as sets to true.
                //me.set('usingSavedCard', true);
            }
        },
        setSavedPaymentMethod: function (newId, manualCard) {
            var me = this,
                customer = me.getOrder().get('customer'),
                card = manualCard || customer.get('cards').get(newId),
                cardBillingContact = card && customer.get('contacts').get(card.get('contactId'));
            if (!card) {
                card = customer.get('cards').findWhere({isDefaultPayMethod: true});   
            }
            me.get('billingContact').set(cardBillingContact.toJSON(), { silent: true });
            me.get('card').set(card.toJSON());
            me.set('paymentType', 'CreditCard');
            me.set('usingSavedCard', true);
            if (Hypr.getThemeSetting('isCvvSuppressed')) {
                me.get('card').set('isCvvOptional', true);
                if (me.parent.get('amountRemainingForPayment') > 0) {
                    return me.applyPayment();
                }
            }
        },
        setPaymentTypeFromCurrentPayment: function () {
            var billingInfoPaymentType = this.get('paymentType'),
                billingInfoPaymentWorkflow = this.get('paymentWorkflow'),
                currentPayment = this.getOrder().apiModel.getCurrentPayment(),
                currentPaymentType = currentPayment && currentPayment.billingInfo.paymentType,
                currentPaymentWorkflow = currentPayment && currentPayment.billingInfo.paymentWorkflow,
                currentBillingContact = currentPayment && currentPayment.billingInfo.billingContact,
                currentCard = currentPayment && currentPayment.billingInfo.card,
                currentPurchaseOrder = currentPayment && currentPayment.billingInfo.purchaseorder,
                purchaseOrderSiteSettings = HyprLiveContext.locals.siteContext.checkoutSettings.purchaseOrder ?
                    HyprLiveContext.locals.siteContext.checkoutSettings.purchaseOrder.isEnabled : false,
                purchaseOrderCustomerSettings = this.getOrder().get('customer').get('purchaseOrder') ? 
                    this.getOrder().get('customer').get('purchaseOrder').isEnabled : false;

            if(purchaseOrderSiteSettings && purchaseOrderCustomerSettings && !currentPayment) {
                currentPaymentType = 'PurchaseOrder';
            }

            if (currentPaymentType && (currentPaymentType !== billingInfoPaymentType || currentPaymentWorkflow !== billingInfoPaymentWorkflow)) {
                this.set('paymentType', currentPaymentType, { silent: true });
                this.set('paymentWorkflow', currentPaymentWorkflow, { silent: true });
                this.set('card', currentCard, { silent: true });
                this.set('billingContact', currentBillingContact, { silent: true });
                this.set('purchaseOrder', currentPurchaseOrder, { silent: true });
            }
        },
        setDefaultPaymentInfo: function(){
            var self = this;
            
            self.setPaymentTypeFromCurrentPayment();
            var savedCardId = self.get('card.paymentServiceCardId'),
                paymentType = self.get('paymentType');

            if (savedCardId) {
                self.set('savedPaymentMethodId', savedCardId, { silent: true });
                self.setSavedPaymentMethod(savedCardId);
            }

            if(paymentType){
                self.selectPaymentType(this, this.get('paymentType'));
            } else {
               self.setDefaultPaymentType(); 
            }
        },
        initialize: function () {
            var me = this,
            billingContact = this.get('billingContact');

            //var dc = _.extend(this.__proto__, DigitalCredits);
            

            var VisaCheckout = new ThirdPartyPayments.VisaCheckout(this);

            _.defer(function () {
                //set purchaseOrder defaults here.
                me.get('purchaseOrder').setPurchaseOrderInfo();
                me.setDefaultPaymentInfo();
                

                // me.on('change:usingSavedCard', function (me, yes) {
                //     if (!yes) {
                //         me.get('card').clear();
                //         me.set('usingSavedCard', false);
                //     }
                //     else {
                //         me.set('isSameBillingShippingAddress', false);
                //         me.setSavedPaymentMethod(me.get('savedPaymentMethodId'));
                //     }
                // });
            });

            this.on('change:paymentType', this.selectPaymentType);

            //Set by DefaultPaymentInfo
            //this.selectPaymentType(this, this.get('paymentType'));

            // this.on('change:isSameBillingShippingAddress', function (model, wellIsIt) {
            //     if (wellIsIt) {
            //         billingContact.set(this.parent.get('fulfillmentInfo').get('fulfillmentContact').toJSON(), { silent: true });
            //     } else if (billingContact) {
            //         // if they initially checked the checkbox, then later they decided to uncheck it... remove the id so that updates don't update
            //         // the original address, instead create a new contact address.
            //         // We also unset contactId to prevent id from getting reset later.
            //         billingContact.unset('id', { silent: true });
            //         billingContact.unset('contactId', { silent: true });
            //     }
            // });
            this.on('change:savedPaymentMethodId', this.syncPaymentMethod);
            this._cachedDigitalCredits = null;

            _.bindAll(this, 'applyPayment', 'markComplete');
        },
        toggleSameAsShippingAdress: function(toggle){
            var billingContact = this.get('billingContact');
            if (toggle) {
                billingContact.set(this.parent.get('fulfillmentInfo').get('fulfillmentContact').toJSON(), { silent: true });
            } else if (billingContact) {
                // if they initially checked the checkbox, then later they decided to uncheck it... remove the id so that updates don't update
                // the original address, instead create a new contact address.
                // We also unset contactId to prevent id from getting reset later.
                //billingContact.unset('id', { silent: true });
                //billingContact.unset('contactId', { silent: true });
                this.clearBillingContact();
            }
        },
        clearBillingContact: function(){
            var billingContact = this.get('billingContact');
            billingContact.clear();
            billingContact.unset('id', { silent: true });
            billingContact.unset('contactId', { silent: true });
        },
        selectPaymentType: function(me, newPaymentType) {
            if (!me.changed || !me.changed.paymentWorkflow) {
                me.set('paymentWorkflow', 'Mozu');
            }
            me.get('check').selected = newPaymentType === 'Check';
            me.get('card').selected = newPaymentType === 'CreditCard';
            me.get('purchaseOrder').selected = newPaymentType === 'PurchaseOrder';
            if(newPaymentType === 'PurchaseOrder') {
                PurchaseOrder.setPurchaseOrderBillingInfo();
            }
        },
        setDefaultPaymentType: function() {
            var self = this;
            if(self.get('purchaseOrder').isPurchaseOrderEnabled()) {
                self.set('paymentType', 'PurchaseOrder');
                self.selectPaymentType(self, 'PurchaseOrder');
            } else {
                self.set('paymentType', 'CreditCard');
                self.selectPaymentType(self, 'CreditCard');
                if (self.savedPaymentMethods() && self.savedPaymentMethods().length > 0) {
                    self.set('usingSavedCard', true);
                    self.setSavedPaymentMethod(self.get('savedPaymentMethodId'));
                }
            }
        },
        hasPaymentChanged: function(payment) {

            // fix this for purchase orders, currently it constantly voids, then re-applys the payment even if nothing changes.
            function normalizeBillingInfos(obj) {
                return {
                    paymentType: obj.paymentType,
                    billingContact: _.extend(_.pick(obj.billingContact,
                        'email',
                        'firstName',
                        'lastNameOrSurname',
                        'phoneNumbers'),
                    {
                        address: obj.billingContact.address ? _.pick(obj.billingContact.address, 
                            'address1',
                            'address2',
                            'addressType',
                            'cityOrTown',
                            'countryCode',
                            'postalOrZipCode',
                            'stateOrProvince') : {}
                    }),
                    card: obj.card ? _.extend(_.pick(obj.card,
                        'expireMonth',
                        'expireYear',
                        'nameOnCard',
                        'isSavedCardInfo'),
                    {
                        cardType: obj.card.paymentOrCardType || obj.card.cardType,
                        cardNumber: obj.card.cardNumberPartOrMask || obj.card.cardNumberPart || obj.card.cardNumber,
                        id: obj.card.paymentServiceCardId || obj.card.id,
                        isCardInfoSaved: obj.card.isCardInfoSaved || false
                    }) : {},
                    purchaseOrder: obj.purchaseOrder || {},
                    check: obj.check || {}
                };
            }

            var normalizedSavedPaymentInfo = normalizeBillingInfos(payment.billingInfo);
            var normalizedLiveBillingInfo = normalizeBillingInfos(this.toJSON());

            if (payment.paymentWorkflow === 'VisaCheckout') {
                normalizedLiveBillingInfo.billingContact.address.addressType = normalizedSavedPaymentInfo.billingContact.address.addressType;
            }
            
            return !_.isEqual(normalizedSavedPaymentInfo, normalizedLiveBillingInfo);
        },
        applyPayment: function () {
            var self = this, order = this.getOrder();
            this.syncApiModel();
            //TO-DO
            //Replace nonStoreCredit
            //
            console.log(order);
            console.log(order.toJSON());
            if (this.nonStoreCreditTotal() > 0) {
                return order.apiAddPayment().then(function() {
                    var payment = order.apiModel.getCurrentPayment();
                    var modelCard, modelCvv;
                    var activePayments = order.apiModel.getActivePayments();
                    var creditCardPayment = activePayments && _.findWhere(activePayments, { paymentType: 'CreditCard' });
                    //Clear card if no credit card payments exists
                    if (!creditCardPayment && self.get('card')) {
                        self.get('card').clear();
                    }
                    if (payment) {
                        switch (payment.paymentType) {
                            case 'CreditCard':
                                modelCard = self.get('card');
                                modelCvv = modelCard.get('cvv');
                                if (
                                    modelCvv && modelCvv.indexOf('*') === -1 // CVV exists and is not masked
                                ) {
                                    modelCard.set('cvv', '***');
                                    // to hide CVV once it has been sent to the paymentservice
                                }

                                self.markComplete();
                                break;
                            default:
                                self.markComplete();
                        }
                    }
                });
            } else {
                this.markComplete();
            }
        },
        markComplete: function () {
            this.stepStatus('complete');
            this.isLoading(false);
            var order = this.getOrder();
            _.defer(function() { 
                order.isReady(true);   
            });
        },
        edit: function () {
            this.setPaymentTypeFromCurrentPayment();
            CheckoutStep.prototype.edit.apply(this, arguments);
        },
        calculateStepStatus: function () {
            var fulfillmentComplete = this.parent.get('fulfillmentInfo').stepStatus() === 'complete',
                activePayments = this.activePayments(),
                thereAreActivePayments = activePayments.length > 0,
                paymentTypeIsCard = activePayments && !!_.findWhere(activePayments, { paymentType: 'CreditCard' }),
                balanceNotPositive = this.parent.get('amountRemainingForPayment') <= 0;

            if (paymentTypeIsCard && !Hypr.getThemeSetting('isCvvSuppressed')) return this.stepStatus('incomplete'); // initial state for CVV entry

            if (!fulfillmentComplete) return this.stepStatus('new');

            if (thereAreActivePayments && (balanceNotPositive || (this.get('paymentType') === 'PaypalExpress' && window.location.href.indexOf('PaypalExpress=complete') !== -1))) return this.stepStatus('complete');
            return this.stepStatus('incomplete');

        },
        submit: function () {

            this.activeStoreCredits(); 
            this.availableDigitalCredits();
            return false;

            var order = this.getOrder();
            // just can't sync these emails right
            order.syncBillingAndCustomerEmail();

            // This needs to be ahead of validation so we can check if visa checkout is being used.
            var currentPayment = order.apiModel.getCurrentPayment();

            // the card needs to know if this is a saved card or not.
            this.get('card').set('isSavedCard', order.get('billingInfo.usingSavedCard'));
            // the card needs to know if this is Visa checkout (or Amazon? TBD)
            if (currentPayment) {
                this.get('card').set('isVisaCheckout', currentPayment.paymentWorkflow.toLowerCase() === 'visacheckout');
            }

            var val = this.validate();
            //TO-DO
            //
            if (this.nonStoreCreditTotal() > 0 && val) {
                // display errors:
                var error = {"items":[]};
                for (var key in val) {
                    if (val.hasOwnProperty(key)) {
                        var errorItem = {};
                        errorItem.name = key;
                        errorItem.message = key.substring(0, ".") + val[key];
                        error.items.push(errorItem);
                    }
                }
                if (error.items.length > 0) {
                    order.onCheckoutError(error);
                }
                return false;
            }

            var card = this.get('card');
            if(this.get('paymentType').toLowerCase() === "purchaseorder") {
                this.get('purchaseOrder').inflateCustomFields();
            }

            if (!currentPayment) {
                return this.applyPayment();
            } else if (this.hasPaymentChanged(currentPayment)) {
                return order.apiVoidPayment(currentPayment.id).then(this.applyPayment);
            } else if (card.get('cvv') && card.get('paymentServiceCardId')) {
                return card.apiSave().then(this.markComplete, order.onCheckoutError);
            } else {
                this.markComplete();
            }
        },
        toJSON: function(options) {
            var j = CheckoutStep.prototype.toJSON.apply(this, arguments), loggedInEmail;
            // 
            // TO-DO
            // New func to replace nonStoreCreditTotal
            // 
            if (this.nonStoreCreditTotal() === 0 && j.billingContact) {
                delete j.billingContact.address;
            }
            if (j.billingContact && !j.billingContact.email) {
                j.billingContact.email = this.getOrder().get('customer.emailAddress');
            }
            return j;
        }
    });

    return BillingInfo;
});