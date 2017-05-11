define([
    'modules/jquery-mozu',
    'underscore',
    'hyprlive',
    'modules/backbone-mozu',
    'modules/api',
    'modules/models-paymentmethods',
    'hyprlivecontext',
],
function ($, _, Hypr, Backbone, api, PaymentMethods, HyprLiveContext) {
	var DigitalCredits = {
    helpers: ['activeStoreCredits', 'availableDigitalCredits', 'nonStoreCreditTotal'],
	activeStoreCredits: function () {
        var active = this.getOrder().apiModel.getActiveStoreCredits();
        return active && active.length > 0 && active;
    },
    loadCustomerDigitalCredits: function () {
        var self = this,
            order = this.getOrder(),
            customer = order.get('customer'),
            activeCredits = this.activeStoreCredits();

        var customerCredits = customer.get('credits');
        if (customerCredits && customerCredits.length > 0) {
            var currentDate = new Date(),
                unexpiredDate = new Date(2076, 6, 4);

            // todo: refactor so conversion & get can re-use - Greg Murray on 2014-07-01 
            var invalidCredits = customerCredits.filter(function(cred) {
                var credBalance = cred.get('currentBalance'),
                    credExpDate = cred.get('expirationDate');
                var expDate = (credExpDate) ? new Date(credExpDate) : unexpiredDate;
                return (!credBalance || credBalance <= 0 || expDate < currentDate);
            });
            _.each(invalidCredits, function(inv) {
                customerCredits.remove(inv);
            });
        }
        self._cachedDigitalCredits = customerCredits;

        if (activeCredits) {
            var userEnteredCredits = _.filter(activeCredits, function(activeCred) {
                var existingCustomerCredit = self._cachedDigitalCredits.find(function(cred) {
                    return cred.get('code').toLowerCase() === activeCred.billingInfo.storeCreditCode.toLowerCase();
                });
                if (!existingCustomerCredit) {
                    return true;
                }
                //apply pricing update.
                existingCustomerCredit.set('isEnabled', true);
                existingCustomerCredit.set('creditAmountApplied', activeCred.amountRequested);
                existingCustomerCredit.set('remainingBalance', existingCustomerCredit.calculateRemainingBalance());
                return false;
            });
            if (userEnteredCredits) {
                this.convertPaymentsToDigitalCredits(userEnteredCredits, customer);
            }
        }
    },
    convertPaymentsToDigitalCredits: function(activeCredits, customer) {
        var me = this;
        _.each(activeCredits, function (activeCred) {
            var currentCred = activeCred;
            return me.retrieveDigitalCredit(customer, currentCred.billingInfo.storeCreditCode, me, currentCred.amountRequested).then(function(digCredit) {
                me.trigger('orderPayment', me.getOrder().data, me);
                return digCredit;
            });
        });
    },
    availableDigitalCredits: function () {
        if (! this._cachedDigitalCredits) { 
            this.loadCustomerDigitalCredits();
        }
        return this._cachedDigitalCredits && this._cachedDigitalCredits.length > 0 && this._cachedDigitalCredits;
    },
    getMaxCreditToApply: function(creditModel, scope, toBeVoidedPayment) {
        var remainingTotal = scope.nonStoreCreditTotal();
        if (!!toBeVoidedPayment) {
            remainingTotal += toBeVoidedPayment;
        }
        var maxAmt = remainingTotal < creditModel.get('currentBalance') ? remainingTotal : creditModel.get('currentBalance');
        return scope.roundToPlaces(maxAmt, 2);
    },
    //
    //Remove and add to billing info as a generic refresh
    //
    refreshBillingInfoAfterAddingStoreCredit: function (order, updatedOrder) {
        var self = this;
        //clearing existing order billing info because information may have been removed (payment info) #68583

        // #73389 only refresh if the payment requirement has changed after adding a store credit.
        var activePayments = this.activePayments();
        var hasNonStoreCreditPayment = (_.filter(activePayments, function (item) { return item.paymentType !== 'StoreCredit'; })).length > 0;
        if ((order.get('amountRemainingForPayment') >= 0 && !hasNonStoreCreditPayment) ||
            (order.get('amountRemainingForPayment') < 0 && hasNonStoreCreditPayment)
            ) {
            order.get('billingInfo').clear();
            order.set(updatedOrder, { silent: true });
        }
        self.setPurchaseOrderInfo();
        self.setDefaultPaymentType(self);
        self.trigger('orderPayment', updatedOrder, self);

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
    applyDigitalCredit: function (creditCode, creditAmountToApply, isEnabled) {
        var self = this,
            order = self.getOrder(),
            maxCreditAvailable = null;

        this._oldPaymentType = this.get('paymentType');
        var digitalCredit = this._cachedDigitalCredits.filter(function(cred) {
             return cred.get('code').toLowerCase() === creditCode.toLowerCase();
        });

        if (! digitalCredit || digitalCredit.length === 0) {
            return self.deferredError(Hypr.getLabel('digitalCodeAlreadyUsed', creditCode), self);
        }
        digitalCredit = digitalCredit[0];
        var previousAmount = digitalCredit.get('creditAmountApplied');
        var previousEnabledState = digitalCredit.get('isEnabled');

        if (!creditAmountToApply && creditAmountToApply !== 0) {
            creditAmountToApply = self.getMaxCreditToApply(digitalCredit, self);
        }
        
        digitalCredit.set('creditAmountApplied', creditAmountToApply);
        digitalCredit.set('remainingBalance',  digitalCredit.calculateRemainingBalance());
        digitalCredit.set('isEnabled', isEnabled);

        //need to round to prevent being over total by .01
        if (creditAmountToApply > 0) {
            creditAmountToApply = self.roundToPlaces(creditAmountToApply, 2);
        }

        var activeCreditPayments = this.activeStoreCredits();
        if (activeCreditPayments) {
            //check if payment applied with this code, remove
            var sameCreditPayment = _.find(activeCreditPayments, function (cred) {
                return cred.status !== 'Voided' && cred.billingInfo && cred.billingInfo.storeCreditCode.toLowerCase() === creditCode.toLowerCase();
            });

            if (sameCreditPayment) {
                if (this.areNumbersEqual(sameCreditPayment.amountRequested, creditAmountToApply)) {
                    var deferredSameCredit = api.defer();
                    deferredSameCredit.reject();
                    return deferredSameCredit.promise;
                }
                if (creditAmountToApply === 0) {
                    return order.apiVoidPayment(sameCreditPayment.id).then(function(o) {
                        order.set(o.data);
                        self.setPurchaseOrderInfo();
                        self.setDefaultPaymentType(self);
                        self.trigger('orderPayment', o.data, self);
                        return o;
                    });
                } else {
                    maxCreditAvailable = self.getMaxCreditToApply(digitalCredit, self, sameCreditPayment.amountRequested);
                    if (creditAmountToApply > maxCreditAvailable) {
                        digitalCredit.set('creditAmountApplied', previousAmount);
                        digitalCredit.set('isEnabled', previousEnabledState);
                        digitalCredit.set('remainingBalance', digitalCredit.calculateRemainingBalance());
                        return self.deferredError(Hypr.getLabel('digitalCreditExceedsBalance'), self);
                    }
                    return order.apiVoidPayment(sameCreditPayment.id).then(function (o) {
                        order.set(o.data);
                        
                        return order.apiAddStoreCredit({
                            storeCreditCode: creditCode,
                            amount: creditAmountToApply
                        }).then(function (o) {
                            self.refreshBillingInfoAfterAddingStoreCredit(order, o.data);
                            return o;
                        });
                    });
                }
            }
        }
        if (creditAmountToApply === 0) {
            return this.getOrder();
        }

        maxCreditAvailable = self.getMaxCreditToApply(digitalCredit, self);
        if (creditAmountToApply > maxCreditAvailable) {
            digitalCredit.set('creditAmountApplied', previousAmount);
            digitalCredit.set('remainingBalance', digitalCredit.calculateRemainingBalance());
            digitalCredit.set('isEnabled', previousEnabledState);
            return self.deferredError(Hypr.getLabel('digitalCreditExceedsBalance'), self);
        }

        return order.apiAddStoreCredit({
            storeCreditCode: creditCode,
            amount: creditAmountToApply,
            email: self.get('billingContact').get('email')
        }).then(function (o) {
            self.refreshBillingInfoAfterAddingStoreCredit(order, o.data);
            return o;
        });
    },
    retrieveDigitalCredit: function (customer, creditCode, me, amountRequested) {
        var self = this;
        return customer.apiGetDigitalCredit(creditCode).then(function (credit) {
            var creditModel = new PaymentMethods.DigitalCredit(credit.data);
            creditModel.set('isTiedToCustomer', false);

            var validateCredit = function() {
                var now = new Date(),
                    activationDate = creditModel.get('activationDate') ? new Date(creditModel.get('activationDate')) : null,
                    expDate = creditModel.get('expirationDate') ? new Date(creditModel.get('expirationDate')) : null;
                if (expDate && expDate < now) {
                    return self.deferredError(Hypr.getLabel('expiredCredit', expDate.toLocaleDateString()), self);
                }
                if (activationDate && activationDate > now) {
                    return self.deferredError(Hypr.getLabel('digitalCreditNotYetActive', activationDate.toLocaleDateString()), self);
                }
                if (!creditModel.get('currentBalance') || creditModel.get('currentBalance') <= 0) {
                    return self.deferredError(Hypr.getLabel('digitalCreditNoRemainingFunds'), self);
                }
                return null;
            };

            var validate = validateCredit();
            if (validate !== null) {
                return null;
            }
            
            var maxAmt = me.getMaxCreditToApply(creditModel, me, amountRequested);
            if (!!amountRequested && amountRequested < maxAmt) {
                maxAmt = amountRequested;
            }
            creditModel.set('creditAmountApplied', maxAmt);
            creditModel.set('remainingBalance', creditModel.calculateRemainingBalance());
            creditModel.set('isEnabled', true);

            me._cachedDigitalCredits.push(creditModel);
            me.applyDigitalCredit(creditCode, maxAmt, true);
            me.trigger('sync', creditModel);
            return creditModel;
        });
    },

    getDigitalCredit: function () {
        var me = this,
            order = me.getOrder(),
            customer = order.get('customer');
        var creditCode = this.get('digitalCreditCode');

        var existingDigitalCredit = this._cachedDigitalCredits.filter(function (cred) {
            return cred.get('code').toLowerCase() === creditCode.toLowerCase();
        });
        if (existingDigitalCredit && existingDigitalCredit.length > 0){
            me.trigger('error', {
                message: Hypr.getLabel('digitalCodeAlreadyUsed', creditCode)
            });
            // to maintain promise api
            var deferred = api.defer();
            deferred.reject();
            return deferred.promise;
        }
        me.isLoading(true);
        return me.retrieveDigitalCredit(customer, creditCode, me).then(function() {
            me.isLoading(false);
            return me;
        });
    },
    digitalCreditPaymentTotal: function () {
        var activeCreditPayments = this.activeStoreCredits();
        if (!activeCreditPayments)
            return null;
        return _.reduce(activeCreditPayments, function (sum, credit) {
            return sum + credit.amountRequested;
        }, 0);
    },
    getDigitalCreditsToAddToCustomerAccount: function() {
        return this._cachedDigitalCredits.where({ isEnabled: true, addRemainderToCustomer: true, isTiedToCustomer: false });
    }
    };
    return DigitalCredits;
});