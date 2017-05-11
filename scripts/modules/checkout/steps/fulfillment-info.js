define([
    'modules/jquery-mozu',
    'underscore',
    'hyprlive',
    'modules/backbone-mozu',
    'modules/api',
    'hyprlivecontext',
    'modules/checkout/model-checkout-step',
    'modules/checkout/steps/fulfillment-contact'
],
function ($, _, Hypr, Backbone, api, HyprLiveContext, CheckoutStep, FulfillmentContact) {

    var FulfillmentInfo = CheckoutStep.extend({
            initialize: function () {
                var self = this;
                // 
                // this.on('change:availableShippingMethods', function (me, value) {
                //     me.updateShippingMethod(me.get('shippingMethodCode'), true);
                // });
                // _.defer(function () {
                //     // This adds the price and other metadata off the chosen
                //     // method to the info object itself.
                //     // This can only be called after the order is loaded
                //     // because the order data will impact the shipping costs.
                //     me.updateShippingMethod(me.get('shippingMethodCode'), true);
                // });
                // 
                
                /**
                 * Used to set default Shipping Method on page load
                 */
                self.chooseDefaultShippingMethod();
            },
            relations: {
                fulfillmentContact: FulfillmentContact
            },
            validation: {
                shippingMethodCode: {
                    required: true,
                    msg: Hypr.getLabel('chooseShippingMethod')
                }
            },
            getOrder: function() {
                return this.parent;
            },
            compareShippingMethods: function(newMethods){
                var self = this;
                return _.isMatch(self.get('availableShippingMethods'), newMethods);
            },
            getShippingMethodsFromContact: function(){
                var self = this;
                self.isLoading(true);
                self.getOrder().apiModel.getShippingMethodsFromContact().then(function (methods) {
                    if(!self.compareShippingMethods(methods)) {
                        self.refreshShippingMethods(methods);
                        self.chooseDefaultShippingMethod();
                    }
                }).ensure(function () {
                    //addr.set('candidateValidatedAddresses', null);
                    self.isLoading(false);
                    //Redundent
                    //parent.isLoading(false);
                    self.calculateStepStatus();
                    //Redundent
                    //parent.calculateStepStatus();
                });  
            },
            refreshShippingMethods: function (methods) {
                this.set({
                    availableShippingMethods: methods
                });

                //Side Affect, Refresh should refresh nothing more
                // //always make them choose again
                //_.each(['shippingMethodCode', 'shippingMethodName'], this.unset, this);

                //Side Affect, Refresh should refresh nothing more
                // //after unset we need to select the cheapest option
                //this.updateShippingMethod();
            },
            chooseDefaultShippingMethod : function(){
                _.each(['shippingMethodCode', 'shippingMethodName'], this.unset, this);
                //after unset we need to select the cheapest option
                this.updateShippingMethod();
            },
            calculateStepStatus: function () {
                // If no shipping required, we're done.
                if (!this.requiresFulfillmentInfo()) return this.stepStatus('complete');

                // If there's no shipping address yet, go blank.
                if (this.get('fulfillmentContact').stepStatus() !== 'complete') {
                    return this.stepStatus('new');
                }

                // Incomplete status for shipping is basically only used to show the Shipping Method's Next button,
                // which does nothing but show the Payment Info step.
                var billingInfo = this.parent.get('billingInfo');
                if (!billingInfo || billingInfo.stepStatus() === 'new') return this.stepStatus('incomplete');

                // Payment Info step has been initialized. Complete status hides the Shipping Method's Next button.
                return this.stepStatus('complete');
            },
            updateShippingMethod: function (code, resetMessage) {
                var available = this.get('availableShippingMethods'),
                    newMethod = _.findWhere(available, { shippingMethodCode: code }),
                    lowestValue = _.min(available, function(ob) { return ob.price; }); // Returns Infinity if no items in collection.

                if (!newMethod && available && available.length && lowestValue) {
                    newMethod = lowestValue;
                }
                if (newMethod) {
                    this.set(newMethod);
                    this.applyShipping(resetMessage);
                }
            },
            applyShipping: function(resetMessage) {
                if (this.validate()) return false;
                var me = this;
                this.isLoading(true);
                var order = this.getOrder();
                if (order) {
                    order.apiModel.update({ fulfillmentInfo: me.toJSON() })
                        .then(function (o) {
                            var billingInfo = me.parent.get('billingInfo');
                            if (billingInfo) {
                                billingInfo.loadCustomerDigitalCredits();
                                // This should happen only when order doesn't have payments..
                                billingInfo.updatePurchaseOrderAmount();
                            }
                        })
                        .ensure(function() {
                            me.isLoading(false);
                            me.calculateStepStatus();
                            me.parent.get('billingInfo').calculateStepStatus();
                            if(resetMessage) {
                                me.parent.messages.reset(me.parent.get('messages'));
                            }
                        });
                }
            },
            next: function () {
                this.stepStatus('complete');
                this.parent.get('billingInfo').calculateStepStatus();
            }
        });
    return FulfillmentInfo;
});