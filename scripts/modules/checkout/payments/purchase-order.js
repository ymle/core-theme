define([
    'modules/jquery-mozu',
    'underscore',
    'hyprlive',
    'modules/backbone-mozu',
    'modules/api',
    'hyprlivecontext',
    'modules/models-paymentmethods' 
],
function ($, _, Hypr, Backbone, api, HyprLiveContext, PaymentMethods) {
	var PurchaseOrder = PaymentMethods.PurchaseOrder.extend({
        validation: {
            purchaseOrderNumber: {
                fn: 'present',
                msg: Hypr.getLabel('purchaseOrderNumberMissing')
            },/*
            customFields: {
                fn: function(value, attr) {
                    var siteSettingsCustomFields = HyprLiveContext.locals.siteContext.checkoutSettings.purchaseOrder.customFields;
                    var purchaseOrderCustomFields = this.get('purchaseOrder').get('customFields').models;
                    var result = null;
                    siteSettingsCustomFields.forEach(function(field) {
                        if(field.isEnabled && field.isRequired) {
                            var fieldInput = $('#mz-payment-pOCustomField-' + field.code);

                            var foundField = purchaseOrderCustomFields.find(function(poField){
                                return poField.code === field.code;
                            });

                            if(foundField && foundField.get('code') && foundField.get('value').length > 0) {
                                fieldInput.removeClass('is-invalid');
                                $('#mz-payment-pOCustomField-' + field.code + '-validation').empty();
                            } else {
                                var errorMessage = field.label + " " + Hypr.getLabel('missing');
                                fieldInput.addClass('is-invalid');
                                $('#mz-payment-pOCustomField-' + field.code + '-validation').text(errorMessage);
                                result = Hypr.getLabel('purchaseOrderCustomFieldMissing');
                            }
                        }
                    });
                    return result;
                }
            },*/
            paymentTerm: {
                fn: function(value, attr) {

                    var selectedPaymentTerm = null;
                    var purchaseOrder = null;
                    if(attr.indexOf('billingInfo') > -1) {
                        purchaseOrder = this.get('billingInfo').get('purchaseOrder');
                        selectedPaymentTerm = this.get('billingInfo').get('purchaseOrder').get('paymentTerm');
                    } else {
                        purchaseOrder = this.get('purchaseOrder');
                        selectedPaymentTerm = this.get('purchaseOrder').get('paymentTerm');
                    }

                    if(!purchaseOrder.selected) {
                        return;
                    }
                    
                    if(!selectedPaymentTerm.get('description')) {
                        return Hypr.getLabel('purchaseOrderPaymentTermMissing');
                    }

                    return;
                }
            }
        },
        getOrder: function() {
            return this.parent.parent;
        },
		updatePurchaseOrderAmount: function() {
            var me = this,
                order = me.getOrder(),
                currentPurchaseOrder = this,
                pOAvailableBalance = currentPurchaseOrder.get('totalAvailableBalance'),
                orderAmountRemaining = order.get('amountRemainingForPayment'),
                amount = pOAvailableBalance > orderAmountRemaining ?
                    orderAmountRemaining : pOAvailableBalance;

            if((!this.get('purchaseOrder').get('isEnabled') && this.get('purchaseOrder').selected) || order.get('payments').length > 0) {
                return;
            }


            currentPurchaseOrder.set('amount', amount);
            if(amount < orderAmountRemaining) {
                currentPurchaseOrder.set('splitPayment', true);
            }

            //refresh ui when split payment is working?
            me.trigger('stepstatuschange'); // trigger a rerender
        },
        isPurchaseOrderEnabled: function() {
            var me = this,
                order = me.getOrder(),
                purchaseOrderInfo = order ?  order.get('customer').get('purchaseOrder') : null,
                purchaseOrderSiteSettings = HyprLiveContext.locals.siteContext.checkoutSettings.purchaseOrder ?
                    HyprLiveContext.locals.siteContext.checkoutSettings.purchaseOrder.isEnabled : false,
                purchaseOrderCustomerEnabled = purchaseOrderInfo ? purchaseOrderInfo.isEnabled : false,
                customerAvailableBalance = purchaseOrderCustomerEnabled ? purchaseOrderInfo.totalAvailableBalance > 0 : false,
                purchaseOrderEnabled = purchaseOrderSiteSettings && purchaseOrderCustomerEnabled && customerAvailableBalance;

            return purchaseOrderEnabled;
        },
        resetPOInfo: function() {
            var me = this,
                currentPurchaseOrder = me;

            currentPurchaseOrder.get('paymentTermOptions').reset();
            currentPurchaseOrder.get('customFields').reset();
            currentPurchaseOrder.get('paymentTerm').clear();

            this.setPurchaseOrderInfo();
        },
        setPurchaseOrderInfo: function() {
            var me = this,
                order = me.getOrder(),
                purchaseOrderInfo = order ? order.get('customer').get('purchaseOrder') : null,
                purchaseOrderEnabled = this.isPurchaseOrderEnabled(),
                currentPurchaseOrder = me,
                siteId = require.mozuData('checkout').siteId,
                currentPurchaseOrderAmount = currentPurchaseOrder.get('amount');

            currentPurchaseOrder.set('isEnabled', purchaseOrderEnabled);
            if(!purchaseOrderEnabled) {
                // if purchase order isn't enabled, don't populate stuff!
                return;
            }

            // Breaks the custom field array into individual items, and makes the value
            //  field a first class item against the purchase order model. Also populates the field if the
            //  custom field has a value.
            currentPurchaseOrder.deflateCustomFields();
            // Update models-checkout validation with flat purchaseOrderCustom fields for validation.
            for(var validateField in currentPurchaseOrder.validation) {
                if(!this.validation['purchaseOrder.'+validateField]) {
                    this.validation['purchaseOrder.'+validateField] = currentPurchaseOrder.validation[validateField];
                }
                // Is this level needed?
                if(!this.parent.validation['billingInfo.purchaseOrder.'+validateField]) {
                    this.parent.validation['billingInfo.purchaseOrder.'+validateField] =
                        currentPurchaseOrder.validation[validateField];
                }
            }

            // Set information, only if the current purchase order does not have it:
            var amount = purchaseOrderInfo.totalAvailableBalance > order.get('amountRemainingForPayment') ?
                    order.get('amountRemainingForPayment') : purchaseOrderInfo.totalAvailableBalance;

            currentPurchaseOrder.set('amount', amount);

            currentPurchaseOrder.set('totalAvailableBalance', purchaseOrderInfo.totalAvailableBalance);
            currentPurchaseOrder.set('availableBalance', purchaseOrderInfo.availableBalance);
            currentPurchaseOrder.set('creditLimit', purchaseOrderInfo.creditLimit);

            if(purchaseOrderInfo.totalAvailableBalance < order.get('amountRemainingForPayment')) {
                currentPurchaseOrder.set('splitPayment', true);
            }
            
            var paymentTerms = [];
            purchaseOrderInfo.paymentTerms.forEach(function(term) {
                if(term.siteId === siteId) {
                    var newTerm = {};
                    newTerm.code = term.code;
                    newTerm.description = term.description;
                    paymentTerms.push(term);
                }
            });
            currentPurchaseOrder.set('paymentTermOptions', paymentTerms, {silent: true});

            var paymentTermOptions = currentPurchaseOrder.get('paymentTermOptions');
            if(paymentTermOptions.length === 1) {
                var paymentTerm = {};
                paymentTerm.code = paymentTermOptions.models[0].get('code');
                paymentTerm.description = paymentTermOptions.models[0].get('description');
                currentPurchaseOrder.set('paymentTerm', paymentTerm);
            }

            this.setPurchaseOrderBillingInfo();
        },
        setPurchaseOrderBillingInfo: function() {
            var me = this,
                order = me.getOrder(),
                purchaseOrderEnabled = this.isPurchaseOrderEnabled(),
                currentPurchaseOrder = me.get('purchaseOrder'),
                contacts = order ? order.get('customer').get('contacts') : null;
            if(purchaseOrderEnabled) {
                if(currentPurchaseOrder.selected && contacts.length > 0) {
                    var foundBillingContact = contacts.models.find(function(item){
                        return item.get('isPrimaryBillingContact');
                            
                    });

                    if(foundBillingContact) {
                        this.set('billingContact', foundBillingContact, {silent: true});
                        currentPurchaseOrder.set('usingBillingContact', true);
                    }
                }
            }
        },
        setPurchaseOrderPaymentTerm: function(termCode) {
            var currentPurchaseOrder = this,
                paymentTermOptions = currentPurchaseOrder.get('paymentTermOptions');
                var foundTerm = paymentTermOptions.find(function(term) {
                    return term.get('code') === termCode;
                });
                currentPurchaseOrder.set('paymentTerm', foundTerm, {silent: true});
        }
    })
    return PurchaseOrder;
});