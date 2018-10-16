define(['modules/jquery-mozu', 'underscore', 'hyprlive', 'hyprlivecontext', 'modules/models-product',
        'modules/cart-monitor', 'modules/api', 'modules/backbone-mozu', 'modules/block-ui', "bxslider"],
    function($, _, Hypr, hyprlivecontext, ProductModels, CartMonitor, api, Backbone, blockUiLoader, bxslider) {

    var QuickViewSlider = function(){
        var self = this;

        this.init = function(el){
            self.bindListeners.call(el, true);
        };

        this.bindListeners =  function (on) {
            var onOrOff = on ? "on" : "off";
            $('.close-slider').on('click',self.closeQuickViewSlider);
            $('.slider-container')[onOrOff]('click', self.closeQuickViewSlider).on('click','div',function(e){
                e.stopPropagation();
            });
        };

        this.closeQuickViewSlider = function(e){
            $('.right-side-slider').removeClass('initial-state');
            $('.right-side-slider').removeClass('slideInRight').addClass('slideOutRight');
            $('body').removeClass('fix-body');
            $('.right-side-slider').parent().css('position','static');
        };
    };

    var slider = new QuickViewSlider();

    var image_bx_slider = "";

    var QuickViewView = Backbone.View.extend({
        events: {
            'click .qvButton': 'buttonClicked',
            'change [data-mz-product-option]': 'onOptionChange',
            'blur [data-mz-product-option]': 'onOptionChange',
            "click [data-mz-quickview-close]": "quickViewClose"
        },

        quickViewClose: function(){
            slider.closeQuickViewSlider();
        },

        initialize: function() {
            this.currentProductCode = null;
            _.bindAll(this, "quickViewClose");
        },

        onOptionChange: function(e) {
            if (window.quickviewProduct !== null) {
                $(".quickViewElement").addClass("is-loading");
                $(".quickViewElement input, .quickViewElement select").attr("disabled", "disabled");
                return this.configure($(e.currentTarget));
            }
        },

        configure: function ($optionEl) {
            var newValue = $optionEl.val(),
                oldValue,
                id = $optionEl.data('mz-product-option'),
                optionEl = $optionEl[0],
                isPicked = (optionEl.type !== "checkbox" && optionEl.type !== "radio") || optionEl.checked,
                option = window.quickviewProduct.get('options').get(id),
                product = window.quickviewProduct;
            if (option) {
                if (option.get('attributeDetail').inputType === "YesNo") {
                    option.set("value", isPicked);
                } else if (isPicked) {
                    oldValue = option.get('value');
                    if (oldValue !== newValue && !(oldValue === undefined && newValue === '')) {
                        option.set('value', newValue);
                    }
                }
            }

            $('button.btnAddToCart').addClass('is-disabled');

            var isRequiredOptionsSet = true;
            $('[data-mz-product-option]').each(function(opt) {
                var currOptVal = $(this).find(":selected").text();

                var productOptions = window.prodOptions.models;

                for (var i = 0; i < productOptions.length; i++) {
                    var currentOptionInFor = productOptions[i].attributes;

                    if (currentOptionInFor.attributeFQN == $(this).data("mzProductOption")) {
                        if (currentOptionInFor.isRequired) {
                            if (!currOptVal || currOptVal === "" || currOptVal && currOptVal.toString().toLowerCase() == "select") {
                                isRequiredOptionsSet = false;
                            }
                        }
                    }
                }
            });

            var prodOptions = [];
            $(product.attributes.options.models).each(function(){
                if(this.attributes.value){
                    prodOptions.push(this);
                }
            });
            product.apiConfigure({options: prodOptions}).then(function(e){

                $(".mz-validationmessage").text("");
                if (isRequiredOptionsSet) {
                    if(window.quickviewProduct.attributes.inventoryInfo.manageStock === true){
                        if (window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable >= 1) {
                            $('button.btnAddToCart').removeClass('is-disabled');
                            $('button.btnAddToCart').removeAttr("disabled");
                        } else {
                            //$(".mz-qty-control").addClass("disabled");
                            $('button.btnAddToCart').addClass('is-disabled');
                            $('button.btnAddToCart').attr("disabled", "disabled");
                        }
                    } else {
                        $('button.btnAddToCart').removeClass('is-disabled');
                        $('button.btnAddToCart').removeAttr("disabled");
                    }
                } else {
                    $('button.btnAddToCart').addClass('is-disabled');
                    $('button.btnAddToCart').attr("disabled", "disabled");
                }

                $(".quickViewElement").removeClass("is-loading");
                $(".quickViewElement input, .quickViewElement select").removeAttr("disabled");
            });
        },

        render: function() {
            var me = this;
            Backbone.MozuView.prototype.render.apply(this);
            this.$('[data-mz-is-datepicker]').each(function(ix, dp) {
                $(dp).dateinput().css('color', Hypr.getThemeSetting('textColor')).on('change  blur', _.bind(me.onOptionChange, me));
            });
        },

        buttonClicked: function(e) {
            blockUiLoader.globalLoader();

            var self = this;
            window.quickviewProduct = null;
            this.currentProductCode = null;
            var qvProductCode = $(e.currentTarget).data("target");
            var product = new ProductModels.Product({
                productCode: qvProductCode
            });
            window.quickviewProduct = product;
            this.currentProductCode = qvProductCode;

            $('.quickViewSlider .quickview-content').html('');

            product.apiGet().then(function() {
                var modalTemplate = Hypr.getTemplate('modules/product/product-quick-view');
                var modalDiv = $('.quickViewSlider');
                var modalDivContent = $('.quickViewSlider .quickview-content');

                var htmlToSetAsContent = modalTemplate.render({
                    model: product.toJSON({
                        helpers: true
                    })
                });

                window.prodOptions = window.quickviewProduct.attributes.options;

                $('.quickViewSlider').html(htmlToSetAsContent);

                slider.init(this);
                $('.quickViewSlider .right-side-slider').removeClass('slideOutRight').addClass('slideInRight').parent().css('position','fixed');
                $('body').addClass('fix-body');

                image_bx_slider = $('.bxslider_img').bxSlider({
                    minSlides: 1,
                    maxSlides: 1,
                    startSlide: 0,
                    mode: 'fade',
                    infiniteLoop: false,
                    hideControlOnEnd: true,
                    slideWidth: 400,
                    slideMargin: 10
                });

                blockUiLoader.unblockUi();

                try {
                    $(modalDiv).children().first().css('float', 'none');

                    // ADD LISTENERS AFTER OPENING QUICK VIEW POPUP
                    $(modalDiv).on('show', function(e) {
                        // REMOVE PREVIOUS EVENTS (IF ANY)
                        $('.quickViewSlider').off('click', 'button.btnAddToCart');
                        $(".quickViewElement").off('click');

                        // ADD LISTENER FOR ADD TO CART
                        $('.quickViewSlider').on('click', 'button.btnAddToCart', function() {
                            var newQty = 1;
                            var body = $("html") || $("body");
                            if(window.quickviewProduct.attributes.inventoryInfo.manageStock === true){
                                if(typeof window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable === "undefined" || !window.quickviewProduct.attributes.purchasableState.isPurchasable ){
                                    blockUiLoader.productValidationMessage();
                                } else {
                                    if (window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable >= newQty) {
                                        window.quickviewProduct.apiAddToCart({
                                            quantity: newQty
                                        }).then(function(){
                                            body.animate({ scrollTop: 0 }, "slow", function(){
                                                CartMonitor.addToCount(newQty);
                                            });
                                            $(".mz-validationmessage").text("");
                                            slider.closeQuickViewSlider();
                                        }, function(err){
                                            $('[data-mz-validationmessage-for="quantity"]').text(Hypr.getLabel('tryAgain'));
                                        });
                                    } else {
                                        window.quickviewProduct.apiAddToCart({
                                            quantity: window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable
                                        }).then(function(){
                                            body.animate({ scrollTop: 0 }, "slow", function(){
                                                CartMonitor.addToCount(newQty);
                                            });
                                            $(".mz-validationmessage").text("");
                                            slider.closeQuickViewSlider();
                                        });
                                    }
                                }
                            } else {
                                window.quickviewProduct.apiAddToCart({
                                    quantity: newQty
                                }).then(function(){
                                    body.animate({ scrollTop: 0 }, "slow", function(){
                                        CartMonitor.addToCount(newQty);
                                    });
                                });
                                $(".mz-validationmessage").text("");
                                slider.closeQuickViewSlider();
                            }

                        });

                        $('#mz-close-button').click(function(e) {
                            e.preventDefault();
                            blockUiLoader.unblockUi();
                        });

                        // ADD LISTENER FOR CLICK OUTSIDE OF QUICKVIEW
                        $(".quickViewElement").on("click", function(e){
                            if(e.target == this){
                                slider.closeQuickViewSlider();
                            }
                        });

                    }); // END OF ADDING LISTENERS

                    $(modalDiv).on('hidden.bs.modal', function(e) {
                        window.quickviewProduct = null;
                    });

                    $(modalDiv).show().trigger("show");
                } catch (err) {
                    console.log('Error Obj:' + err);
                }
            });
        }
    }); // END OF PRODUCT DETAILS QUICK VIEW

    $(document).ready(function(){
        var quickViewView = new QuickViewView({
            el: $('body')
        });
    });
});