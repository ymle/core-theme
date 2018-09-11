define([
    "modules/jquery-mozu",
    "underscore",
    "modules/backbone-mozu",
    "modules/api",
    "hyprlive",
    "modules/models-token"
],function ($, _, Backbone, api, Hypr, TokenModel) {

    var AwsCheckoutPage = Backbone.MozuModel.extend({
            mozuType: 'order',
            awsData: null,
            handlesMessages: true,
            tokenDetails : null,
            initialize: function (data) {
                var self = this;
                _.bindAll(this, "submit");

            },
            applyShippingMethods: function(existingShippingMethodCode) {
                var me = this;
                //me.isLoading( true);
                me.apiModel.getShippingMethods(null, {silent:true}).then(
                    function (methods) {

                        if (methods.length === 0) {
                            me.onCheckoutError(Hypr.getLabel("awsNoShippingOptions"));
                        }
                        
                        var shippingMethod = "";
                        if (existingShippingMethodCode)
                            shippingMethod = _.findWhere(methods, {shippingMethodCode: existingShippingMethodCode});
                        
                        if (!shippingMethod || !shippingMethod.shippingMethodCode)
                            shippingMethod =_.min(methods, function(method){return method.price;});
                        
                        var fulfillmentInfo = me.get("fulfillmentInfo");
                        fulfillmentInfo.shippingMethodCode = shippingMethod.shippingMethodCode;
                        fulfillmentInfo.shippingMethodName = shippingMethod.shippingMethodName;
                     
                        
                        me.apiModel.update({ fulfillmentInfo: fulfillmentInfo}, {silent: true}).then(
                            function() {
                                //me.isLoading (false);
                                me.set("fulfillmentInfo", fulfillmentInfo);
                                me.applyBilling();
                            });
                    });
            },
            applyBilling: function() {
                var me = this;
                //me.isLoading (true);

                return api.all.apply(api,_.map(_.filter(me.apiModel.getActivePayments(), function(payment) {
                    return payment.paymentType !== "StoreCredit" && payment.paymentType !== "GiftCard";
                }), function(payment) {
                    return me.apiVoidPayment(payment.id);
                })).then(function() {
                    return me.apiGet(null, { silent: true });
                }).then(function(order) {
                    return me.applyPayment();
                });
            },
            applyPayment: function() {
                var me = this;
                if (me.get("amountRemainingForPayment") < 0) {
                    me.trigger('awscheckoutcomplete', me.id);
                    return;
                }
                var user = require.mozuData('user');
                var billingContact = me.tokenDetails.billingContact || {};
                billingContact.email = (user.email !== "" ? user.email : me.get("fulfillmentInfo").fulfillmentContact.email);

                 var billingInfo = {
                    "newBillingInfo" : 
                    {   
                        "card" : null,
                        "billingContact" : billingContact,
                        "orderId" : me.id,
                        "isSameBillingShippingAddress" : false,
                        "paymentType": "token",
                        "token": {
                            "paymentServiceTokenId": me.awsData.id,
                            "type": "PAYWITHAMAZON"
                           },
                        data : {
                            "awsData" : me.awsData
                        }
                    }
                };

                me.apiModel.createPayment(billingInfo, {silent:true}).then( function() {
                    me.trigger('awscheckoutcomplete', me.id);
                    me.isLoading(false);
               }, function(err) {
                    me.isLoading(false);
               });
            },
            submit: function() {
                var me = this;
                me.isLoading(true);
                var fulfillmentInfo = me.get("fulfillmentInfo"),
                    existingShippingMethodCode = fulfillmentInfo.shippingMethodCode;

                if (me.awsData === null)
                    me.awsData = fulfillmentInfo.data;
                else 
                    fulfillmentInfo.data = me.awsData;

                var payWithAmazonToken = new TokenModel.Token({ type: 'PAYWITHAMAZON' });
                payWithAmazonToken.set('tokenObject', me.awsData);
                payWithAmazonToken.apiCreate().then(function(response){
                    me.awsData.id = response.id;

                    payWithAmazonToken.apiModel.thirdPartyPaymentExecute({
                        methodName: "tokenDetails",
                        cardType: "PAYWITHAMAZON",
                        body: null,
                        tokenId: response.id
                    }).then(function(details) {
                        console.log(details);
                        me.tokenDetails = details;

                        var shipping = details.shippingContact;
                        var user = require.mozuData('user');
                        if (user && user.email)
                            shipping.email =  user.email; 

                        me.apiModel.updateShippingInfo({fulfillmentContact : shipping, data: me.awsData}, { silent: true }).then(function(result) {
                            me.set("fulfillmentInfo",result.data);
                            if (me.apiModel.data.requiresFulfillmentInfo)
                                me.applyShippingMethods(existingShippingMethodCode);
                            else
                                me.applyBilling();
                        });
                    });
                });
            },
             onCheckoutError: function (msg) {
                var me = this,
                    errorHandled = false,
                    error = {};
                    //me.messages.add(msg || Hypr.getLabel('unknownError'));
                me.isLoading(false);
                error = {
                        items: [
                            {
                                message: msg || Hypr.getLabel('unknownError')
                            }
                        ]
                    };
                this.trigger('error', error);
                throw error;
            }
        });

    return {
            AwsCheckoutPage: AwsCheckoutPage
        };
});