define([
    'modules/jquery-mozu',
    'underscore',
    'hyprlive',
    'modules/backbone-mozu',
    'modules/api',
    'modules/models-customer',
    'modules/models-paymentmethods',
    'hyprlivecontext',
    'modules/checkout/steps/billing-info'
],
function ($, _, Hypr, Backbone, api, CustomerModels, PaymentMethods, HyprLiveContext, BillingInfo) {
    var VisaCheckout = Backbone.MozuModel.extend({
        helpers: ['visaCheckoutFlowComplete'],
    	visaCheckoutFlowComplete: function() {
            return this.get('paymentWorkflow') === 'VisaCheckout';
        },
        cancelVisaCheckout: function() {
            var self = this;
            var order = this.getOrder();
            var currentPayment = order.apiModel.getCurrentPayment();
            return order.apiVoidPayment(currentPayment.id).then(function() {
                self.clear();
                self.stepStatus('incomplete');
                // need to re-enable purchase order information if purchase order is available.
                self.setPurchaseOrderInfo();
                // Set the defualt payment method for the customer.
                self.setDefaultPaymentType(self);
            });
        }
    })
});