define([
    'modules/jquery-mozu',
    'underscore',
    'hyprlive',
    'modules/backbone-mozu',
    'modules/api',
    'modules/models-customer',
    'hyprlivecontext'
    'modules/checkout/model-checkout-step'
],
function ($, _, Hypr, Backbone, api, CustomerModels, HyprLiveContext, CheckoutStep) {

    var FulfillmentContact = CheckoutStep.extend({
            relations: CustomerModels.Contact.prototype.relations,
            validation: CustomerModels.Contact.prototype.validation,
            digitalOnlyValidation: {
                'email': {
                    pattern: 'email',
                    msg: Hypr.getLabel('emailMissing')
                } 
            },
            dataTypes: {
                contactId: function(val) {
                    return (val === 'new') ? val : Backbone.MozuModel.DataTypes.Int(val);
                }
            },
            helpers: ['contacts'],
            contacts: function () {
                var contacts = this.getOrder().get('customer').get('contacts').toJSON();
                return contacts && contacts.length > 0 && contacts;
            },
            initialize: function () {
                var self = this;
                //
                // Remove Event Listener for Change Contact Id, Add call to change
                //
                // this.on('change:contactId', function (model, newContactId) {
                //     if (!newContactId || newContactId === 'new') {
                //         model.get('address').clear();
                //         model.get('phoneNumbers').clear();
                //         model.unset('id');
                //         model.unset('firstName');
                //         model.unset('lastNameOrSurname');
                //     } else {
                //         model.set(model.getOrder().get('customer').get('contacts').get(newContactId).toJSON(), {silent: true});
                //     }
                // });
            },
            validateModel: function(){
                var validationObj = this.validate();

                if (validationObj) { 
                    Object.keys(validationObj).forEach(function(key){
                        this.trigger('error', {message: validationObj[key]});
                    }, this);

                    return false;
                }
            },
            newContact: function(){
                var self = this;
                self.set('contactId', 'new');
                self.get('address').clear();
                self.get('phoneNumbers').clear();
                self.unset('id');
                self.unset('firstName');
                self.unset('lastNameOrSurname');
            },
            updateContact: function(contactId){
                var self = this;
                self.set('contactId', contactId);
                if(!contactId || contactId === 'new') {
                    self.newContact();
                    return;
                } 

                self.set(self.getOrder().get('customer').get('contacts').get(contactId).toJSON(), {silent: true});    
            },
            calculateStepStatus: function () {
                if (!this.requiresFulfillmentInfo() && this.requiresDigitalFulfillmentContact()) {
                    this.validation = this.digitalOnlyValidation;
                }

                if (!this.requiresFulfillmentInfo() && !this.requiresDigitalFulfillmentContact()) return this.stepStatus('complete');
                return CheckoutStep.prototype.calculateStepStatus.apply(this);
            },
            // //
            // Duplicate from parent Item
            // //
            // getOrder: function () {
            //     // since this is one step further away from the order, it has to be accessed differently
            //     return this.parent.parent;
            // },
            choose: function (e) {
                var idx = parseInt($(e.currentTarget).val(), 10);
                if (idx !== -1) {
                    var addr = this.get('address');
                    var valAddr = addr.get('candidateValidatedAddresses')[idx];
                    for (var k in valAddr) {
                        addr.set(k, valAddr[k]);
                    }
                }
            },
            toJSON: function () {
                if (this.requiresFulfillmentInfo() || this.requiresDigitalFulfillmentContact()) {
                    return CheckoutStep.prototype.toJSON.apply(this, arguments);
                }
            },
            //Rename for clear
            isDigitalValid: function() {
                var email = this.get('email');
                return (!email) ? false : true;
            },
            //Rename for clear
            // Breakup into seperate api update for fulfillment
            nextDigitalOnly: function () {
                var order = this.getOrder(),
                    self = this;

                if (self.validate()) return false;
                self.getOrder().apiModel.update({ fulfillmentInfo: me.toJSON() }).ensure(function () {
                    self.isLoading(false);
                    order.messages.reset();
                    order.syncApiModel();

                    self.calculateStepStatus();
                    return order.get('billingInfo').calculateStepStatus();
                });
            },
            validateAddresses : function(){
                var deferredValidate = api.defer(),
                    isAddressValidationEnabled = HyprLiveContext.locals.siteContext.generalSettings.isAddressValidationEnabled,
                    allowInvalidAddresses = HyprLiveContext.locals.siteContext.generalSettings.allowInvalidAddresses;
                
                var promptValidatedAddress = function () {
                    order.syncApiModel();
                    self.isLoading(false);
                    // Redundent
                    //parent.isLoading(false);
                    self.stepStatus('invalid');
                }

                if (!isAddressValidationEnabled) {
                    deferredValidate.resolve();
                } else {
                    if (!addr.get('candidateValidatedAddresses')) {
                        var methodToUse = allowInvalidAddresses ? 'validateAddressLenient' : 'validateAddress';
                        addr.syncApiModel();
                        addr.apiModel[methodToUse]().then(function (resp) {
                            if (resp.data && resp.data.addressCandidates && resp.data.addressCandidates.length) {
                                if (_.find(resp.data.addressCandidates, addr.is, addr)) {
                                    addr.set('isValidated', true);
                                        deferredValidate.resolve();
                                        return;
                                    }
                                addr.set('candidateValidatedAddresses', resp.data.addressCandidates);
                                promptValidatedAddress();
                            } else {
                                deferredValidate.resolve();
                            }
                        }, function (e) {
                            if (allowInvalidAddresses) {
                                // TODO: sink the exception.in a better way.
                                order.messages.reset();
                                deferredValidate.reject();
                            } else {
                                order.messages.reset({ message: Hypr.getLabel('addressValidationError') });
                            }
                        });
                    } else {
                        deferredValidate.reject();
                    }
                }
                return deferredValidate.promise;
            }
            // Breakup for validation
            // Break for compelete step
            next: function () {
                var self = this;
                if (!self.requiresFulfillmentInfo() && self.requiresDigitalFulfillmentContact()) {
                    return self.nextDigitalOnly();
                }

                //Moved to Validate Model
                // var validationObj = this.validate();

                // if (validationObj) { 
                //     Object.keys(validationObj).forEach(function(key){
                //         this.trigger('error', {message: validationObj[key]});
                //     }, this);

                //     return false;
                // }
               if(!validateModel()) return false;

               var parent = self.parent,
                    order = self.getOrder(),
                    addr = this.get('address');

                this.isLoading(true);

                var completeStep = function () {
                    order.messages.reset();
                    order.syncApiModel();
                    self.isLoading(true);
                    //
                    // Remove getShippingMethodsFromContact, move to shipping Fulfillment as call to refresh
                    // 
                    //
                    order.apiModel.getShippingMethodsFromContact().then(function (methods) {
                        return parent.refreshShippingMethods(methods);
                    }).ensure(function () {
                        addr.set('candidateValidatedAddresses', null);
                        self.isLoading(false);
                        //Redundent
                        //parent.isLoading(false);
                        self.calculateStepStatus();
                        //Redundent
                        //parent.calculateStepStatus();
                    });                  
                }
                validateAddresses.then(function(){
                    completeStep();
                })
            }
        })
})