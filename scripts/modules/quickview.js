/* jshint scripturl: true */
/* global POWERREVIEWS */
define([
        'modules/jquery-mozu',
        'underscore',
        'hyprlive',
        'hyprlivecontext',
        'modules/models-product',
        'modules/cart-monitor',
        'modules/api',
        'modules/backbone-mozu',
        'modules/block-ui',
        "bxslider"/*,
        "widgets/powerreviews"*/
],
function($, _, Hypr, hyprlivecontext, ProductModels, CartMonitor, api, Backbone, blockUiLoader, bxslider /*, MzPR*/) {

    var sitecontext = hyprlivecontext.locals.siteContext;
    var cdn = sitecontext.cdnPrefix;
    var siteID = cdn.substring(cdn.lastIndexOf('-') + 1);
    var imagefilepath = cdn + '/cms/' + siteID + '/files';
    var wishlistId = 0;
    var apiData = require.mozuData('apicontext');
    var QuickviewSlider = function(){
        var self = this;
        this.init = function(el){
            self.bindListeners.call(el, true);
        };
        this.bindListeners =  function (on) {
            var onOrOff = on ? "on" : "off";
            $('.close-slider').on('click',self.closeQuickviewSlider);
            $('.slider-container')[onOrOff]('click', self.closeQuickviewSlider).on('click','div',function(e){
                e.stopPropagation();
            });
        };
        this.closeQuickviewSlider = function(e){
            $('.right-side-slider').removeClass('initial-state');
            $('.right-side-slider').removeClass('slideInRight').addClass('slideOutRight');
            $('body').removeClass('fix-body');
            $('#page-wrapper').css("margin-right", "");
            $('.right-side-slider').parent().css('position','static');
        };
    };
    var slider = new QuickviewSlider();
    var updateWishlistUI = function(added){
        if(added){
            $('.quickviewSlider .mz-wishlist').addClass('addedToWishList');
            $('#add-to-wishlist').addClass('is-disabled').prop('disabled','disabled').children('span').text(Hypr.getLabel('addedToWishlist'));
            $('.quickviewSlider .mz-wishlist').children("a").children('img').attr("src", "/resources/images/icons/wishlistheartSaved.png");
        }
        else{
            $('.quickviewSlider .mz-wishlist').removeClass('addedToWishList');
            $('.quickviewSlider .mz-wishlist').children("a").children('img').attr("src", "/resources/images/icons/wishlistheart.png");
            $('#add-to-wishlist').removeClass('is-disabled').prop('disabled', 'false').children('span').text(Hypr.getLabel('addToWishlist'));

        }
        blockUiLoader.unblockUi();
        $(".quickviewElement").removeClass("is-loading");
    };

    var image_bx_slider = "";

    //using GET request CheckImage function checks whether an image exist or not
    var checkImage = function(imagepath, callback){
        $.get(imagepath).done(function(){
            callback(true);//return true if image exist
        });
    };
    function showStockMessage(){
        if(typeof window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable !== 'undefined'){
            var html = "";
            var sp_price = "";
            var inventoryInfo = window.quickviewProduct.get('inventoryInfo');
            if(typeof window.quickviewProduct.attributes.price.get('salePrice') != 'undefined')
                sp_price = window.quickviewProduct.attributes.price.get('salePrice');
            else
                sp_price = window.quickviewProduct.attributes.price.get('price');
            var price = Hypr.engine.render("{{price|currency}}",{ locals: { price: sp_price }});

            var isPreorder = window.quickviewProduct.get("price").get('msrp')===1?true:false;
            var stockMsglabel = Hypr.getLabel('upcInStock');
            if(inventoryInfo.onlineStockAvailable===0){
                stockMsglabel = Hypr.getLabel('outOfStock');
            }else if(isPreorder)
                stockMsglabel = Hypr.getLabel('preOrderLabel');
            html += '<div class="stock-message">' + stockMsglabel + ' - ' + price +'</div>';
            //As we want to display UPC message,even when Product is OUT OF STOCK
            var upc = window.quickviewProduct.get('upc');
            if(upc)
                html += '<div class="upc-message">'+upc+'</div>';
            $('#stock-upc-msg').html(html);
        }
    }
    var QuickViewView = Backbone.View.extend({
        events: {
            'click .qvButton': 'buttonClicked',
            'change [data-mz-product-option]': 'onOptionChange',
            'blur [data-mz-product-option]': 'onOptionChange',
            "click [data-mz-product-box]": "onAttributeButtonClick",
            "click [data-mz-swatch-color]": "selectSwatch",
            'click .mz-productimages-thumb': 'imgChange',
            "click [data-mz-quickview-close]": "quickviewClose"
        },
        quickviewClose: function(){
            slider.closeQuickviewSlider();
        },
        initialize: function() {
            this.currentProductCode = null;
            _.bindAll(this, "quickviewClose");
        },

        imgChange: function (e){
            e.preventDefault();
            $(".quickviewElement .mz-productimages-mainimage").attr("src", $(e.currentTarget).attr("href"));
        },

        onOptionChange: function(e) {
            if (window.quickviewProduct !== null) {
                $(".quickviewElement").addClass("is-loading");
                $(".quickviewElement input, .quickviewElement select").attr("disabled", "disabled");
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

            $('button.btnAddToCart').addClass('is-disabled')/*.prop('disabled','disabled')*/;

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

                        if(window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable > 0 && window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable <= hyprlivecontext.locals.themeSettings.minimumQuantityForInStockQuantityMessage){
                            $(".mz-validationmessage").text("*Only " + window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable + " left in stock.");
                        }
                        if (window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable >= 1) {
                            $('button.btnAddToCart').removeClass('is-disabled')/*.prop('disabled', false)*/;
                            $('button.btnAddToCart').removeAttr("disabled");
                        } else {
                            $(".mz-qty-control").addClass("disabled");
                            $('button.btnAddToCart').addClass('is-disabled');
                            $('button.btnAddToCart').attr("disabled", "disabled");
                        }
                    } else {
                        $('button.btnAddToCart').removeClass('is-disabled')/*.prop('disabled', false)*/;
                        $('button.btnAddToCart').removeAttr("disabled");
                    }
                } else {
                    $('button.btnAddToCart').addClass('is-disabled');
                    $('button.btnAddToCart').attr("disabled", "disabled");
                    $("#add-to-wishlist").addClass("is-disabled").prop('disabled','disabled');
                }

                $(".quickviewElement").removeClass("is-loading");
                $(".quickviewElement input, .quickviewElement select").removeAttr("disabled");
                //showStockMessage();
                // SHOW ERROR ON FIELDS NOT FILLED IN
                // if($(".mz-productoptions-valuecontainer input:radio")){
                //     var color = "#ff0000";
                //     if($(".mz-productoptions-valuecontainer input:radio:checked").val()){
                //         color = "#000";
                //     }
                //     $(".mz-productoptions-valuecontainer input:radio + label").each(function(){
                //         $(this).css("border-color", color);
                //     });
                // }
                // $(".mz-productdetail-options input, .mz-productdetail-options select").each(function(){
                //     if(($(this).val() && $(this).val().toLowerCase() == "select") || !$(this).val()){
                //         $(this).css("border-color", "red");
                //     } else {
                //         $(this).css("border-color", "black");
                //     }
                // });
            });
        },

        onAttributeButtonClick: function(e) {
            if($(e.currentTarget).attr('disabled')=='disabled'){
                return false;
            }else{
                if (window.quickviewProduct !== null) {
                    $(".quickviewElement").addClass("is-loading");
                    $(".quickviewElement input, .quickviewElement ul.product-swatches").attr("disabled", "disabled");
                    $(e.currentTarget).addClass('active').siblings().removeClass('active');
                    var option_val = $(e.currentTarget).data('value');
                    if($(e.currentTarget).parents('.mz-productoptions-optioncontainer').find('.mz-productoptions-optionlabel').data('option') === "Color"){
                        $(e.currentTarget).parents('.mz-productoptions-optioncontainer').find('.mz-productoptions-optionlabel').text('COLOR: '+option_val);
                    }
                    if($(e.currentTarget).parents('.mz-productoptions-optioncontainer').find('.mz-productoptions-optionlabel').data('option') === "Size"){
                        $(e.currentTarget).parents('.mz-productoptions-optioncontainer').find('.mz-productoptions-optionlabel').text('SIZE: '+option_val);
                    }
                    return this.configureAttribute($(e.currentTarget));
                }
            }
        },

        configureAttribute: function($optionEl) {
            var newValue = $optionEl.data('value'),
                oldValue,
                id = $optionEl.data('mz-product-box'),
                optionEl = $optionEl[0],
                isPicked = (optionEl.type !== 'checkbox' && optionEl.type !== 'radio') || optionEl.checked,
                option = window.prodOptions.get(id),
                product = window.quickviewProduct;
            if (option) {
                if (option.get('attributeDetail').inputType === 'YesNo') {
                    option.set("value", isPicked);
                } else if (isPicked) {
                    oldValue = option.get('value');
                    if (oldValue !== newValue && !(oldValue === undefined && newValue === '')) {
                        option.set('value', newValue);
                    }
                }
            }

            $('button.btnAddToCart').addClass('is-disabled')/*.prop('disabled','disabled')*/;

            var isRequiredOptionsSet = true;
            $('[data-mz-product-box]').each(function(opt) {
                var currOptVal = $(this).data('value');

                var productOptions = window.prodOptions.models;

                for (var i = 0; i < productOptions.length; i++) {
                    var currentOptionInFor = productOptions[i].attributes;

                    if (currentOptionInFor.attributeFQN == $(this).data("mzProductBox")) {
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

                //Update the size buttons state
                for(var option in e.data.options){
                    if(e.data.options[option].attributeFQN === "tenant~SIZE"){
                        for(var value in e.data.options[option].values){
                            if(e.data.options[option].values[value].isEnabled){
                                $('.product-swatches li[data-value="'+e.data.options[option].values[value].value+'"]').attr('disabled', false);
                            }else{
                                $('.product-swatches li[data-value="'+e.data.options[option].values[value].value+'"]').attr('disabled', true).removeClass('active');
                                if($('[data-option=Size]').text().indexOf(e.data.options[option].values[value].value)>=0)
                                {
                                    $('[data-option=Size]').text('select a size');
                                }
                            }
                        }
                    }
                }

                $(".mz-validationmessage").text("");
                if (isRequiredOptionsSet) {
                    if(window.quickviewProduct.attributes.inventoryInfo.manageStock === true){

                        if(window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable > 0 && window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable <= hyprlivecontext.locals.themeSettings.minimumQuantityForInStockQuantityMessage){
                            $(".mz-validationmessage").text("*Only " + window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable + " left in stock.");
                        }
                        if (window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable >= 1) {
                            $('button.btnAddToCart').removeClass('is-disabled')/*.prop('disabled', false)*/;

                            $(".quickviewElement input, .quickviewElement ul.product-swatches").removeAttr("disabled");
                            $(".quickviewElement").removeClass("is-loading");
                        } else {
                            $(".mz-qty-control").addClass("disabled");
                            $('button.btnAddToCart').addClass('is-disabled');

                            $(".quickviewElement input, .quickviewElement ul.product-swatches").attr("disabled", "disabled");
                        }
                    } else {
                        $('button.btnAddToCart').removeClass('is-disabled')/*.prop('disabled', false)*/;
                        $(".quickviewElement input, .quickviewElement ul.product-swatches").removeAttr("disabled");
                    }

                } else {
                    $('button.btnAddToCart').addClass('is-disabled');
                    $(".quickviewElement input, .quickviewElement ul.product-swatches").attr("disabled", "disabled");
                    $("#add-to-wishlist").addClass("is-disabled").prop('disabled','disabled');
                }
                //$(".quickviewElement input, .quickviewElement ul.product-swatches").removeAttr("disabled");
                $(".quickviewElement").removeClass("is-loading");
                showStockMessage();
            });
        },

        render: function() {
            var me = this;
            Backbone.MozuView.prototype.render.apply(this);
            this.$('[data-mz-is-datepicker]').each(function(ix, dp) {
                $(dp).dateinput().css('color', Hypr.getThemeSetting('textColor')).on('change  blur', _.bind(me.onOptionChange, me));
            });
        },

        selectSwatch: function(e) {
            //console.log("updating image swatch");
            var colorCode = $(e.currentTarget).data('mz-swatch-color').toLowerCase();
            var width = hyprlivecontext.locals.themeSettings.quickViewImageMaxWidth;
            var imagepath = imagefilepath + '/' + window.quickviewProduct.attributes.productCode + '_' + colorCode + '.jpg?maxWidth= ' + width;
            checkImage(imagepath, function(response){
                if(response) {
                    if($('.bxslider_img').length){
                        image_bx_slider.goToSlide(0);
                        $('.bxslider_img li:not(.bx-clone):first').children('img').attr('src', imagepath);
                    }else{
                        $('.mz-productimages-mainimage').attr('src', imagepath);
                    }
                }
            });
        },

        buttonClicked: function(e) {
            blockUiLoader.globalLoader();
            // QUICK VIEW BUTTON CLICKED -- OPEN QUICK VIEW WINDOW
            var self = this;

            window.quickviewProduct = null;
            this.currentProductCode = null;

            // Reset modal dialog content
            $('.quickviewSlider .quickview-content').html('');

            var qvProductCode = $(e.currentTarget).data("target");
            var product = new ProductModels.Product({
                productCode: qvProductCode
            });

            window.quickviewProduct = product;

            this.currentProductCode = qvProductCode;

            product.apiGet().then(function() {
                api.get('wishlist').then(function(wishlist) {
                    return wishlist.data.items;
                }).then(function(wishlistItems) {
                    window.wishlist = wishlistItems;
                    var isAlreadyAdded= false;
                    for (var i = 0; i < wishlistItems.length; i++) {
                        wishlistId = wishlistItems[i].id;
                        for (var j = 0; j < wishlistItems[i].items.length; j++) {
                            if (wishlistItems[i].items[j].product && wishlistItems[i].items[j].product.productCode == product.attributes.productCode) {
                                if(wishlistItems[i].items[j].product.variationProductCode){
                                    if(wishlistItems[i].items[j].product.variationProductCode == window.quickviewProduct.attributes.variationProductCode){
                                        updateWishlistUI(true);
                                        isAlreadyAdded = true;
                                        break;
                                    }
                                } else {
                                    updateWishlistUI(true);
                                }
                            }
                        }
                    }
                    if(!isAlreadyAdded){
                        updateWishlistUI(false);
                    }
                }, function(){
                    blockUiLoader.unblockUi();
                });
                var options_pro = product.attributes.options;
                var availableColors = [];
                if(options_pro.models){
                    for (var i = 0; i < options_pro.models.length; i++) {
                        if (options_pro.models[i].id == "tenant~color") {
                            for (var j = 0; j < options_pro.models[i].legalValues.length; j++) {
                                var color = options_pro.models[i].legalValues[j].trim().replace(/ /g, '_').toLowerCase();
                                var swatchIconSize = 57;
                                var swatchIconPath = imagefilepath + '/' + options_pro.models[i].collection.parent.id + '_' + color + '_sw.jpg?max='+swatchIconSize;
                                availableColors.push({
                                    color: options_pro.models[i].legalValues[j],
                                    swatchIconPath: swatchIconPath,
                                    swatch_color: color
                                });
                            }
                            product.attributes.availableColors = availableColors;
                        }
                    }
                }
                var sizeObj = "";
                sizeObj = _.find(product.attributes.properties, function(e) {
                    return e.attributeFQN === "tenant~moreInfo" && e.values;
                });
                //If Size Object exist then append a new key "sizeChartImagePath".
                product.attributes.sizeChartPath = sizeObj ? (sizeObj.values[0].stringValue) : null;
                product.attributes.quickView = "yes";

                var modalTemplate = Hypr.getTemplate('modules/product/product-quick-view');

                var modalDiv = $('.quickviewSlider');
                var modalDivContent = $('.quickviewSlider .quickview-content');

                var htmlToSetAsContent = modalTemplate.render({
                    model: product.toJSON({
                        helpers: true
                    })
                });

                // SET OPTIONS
                window.prodOptions = window.quickviewProduct.attributes.options;

                // SET QUICKVIEW POPUP CONTENTS
                $('.quickviewSlider').html(htmlToSetAsContent);
                if($('.quickviewSlider .right-side-slider').hasClass('slideInRight')){
                    slider.closeSizeChartSlider();
                }else{
                    slider.init(this);
                    $('.quickviewSlider .right-side-slider').removeClass('slideOutRight').addClass('slideInRight').parent().css('position','fixed');
                    var widthBefore = $('#page-wrapper').width();
                    $('body').addClass('fix-body');
                    $('#page-wrapper').css("margin-right", $('#page-wrapper').width() - widthBefore + "px");
                    image_bx_slider = $('.bxslider_img').bxSlider({
                        minSlides: 1,
                        maxSlides: 1,
                        startSlide: 0,
                        mode: 'fade',
                        infiniteLoop: false,
                        hideControlOnEnd: true,
                        slideWidth: hyprlivecontext.locals.themeSettings.listProductQuickviewImageMaxWidth,
                        slideMargin: 10
                    });
                    if(window.prodOptions.length <= 0){
                        $("#add-to-wishlist").removeClass('is-disabled').prop('disabled', false);
                    }
                    if(window.prodOptions.length === 1 || window.prodOptions.length === 2){
                        var selected = true;
                        for(var p = 0; p < window.prodOptions.models.length; p++){
                            var selected_option = true;
                            if(window.prodOptions.models[p].attributes.values.length === 1){
                                if(window.prodOptions.models[p].attributes.values[0].isSelected === true){
                                    selected_option = true;
                                }
                            }else{
                                selected_option = false;
                            }
                            selected = selected * selected_option;
                        }
                        if(selected === 1)
                            $("#add-to-wishlist").removeClass('is-disabled').prop('disabled', false);
                    }
                    blockUiLoader.unblockUi();

                    try {
                        $(modalDiv).children().first().css('float', 'none');

                        // ADD LISTENERS AFTER OPENING QUICK VIEW POPUP
                        $(modalDiv).on('show', function(e) {
                            function getNumberOfColoredImages(num, color, prod){
                                var cdn = hyprlivecontext.locals.siteContext.cdnPrefix +"/cms/files/";

                                $.get(cdn + prod.id +"_"+ color + "_"+ num +".jpg").then(function(){
                                    num++;
                                    getNumberOfColoredImages(num, color, prod);
                                }, function(){
                                    prod.attributes.colorMaps.push({color: color, numOfImgsIndex: num});
                                });

                            }

                            // Check for color mapping
                            var imageMapping = _.find(window.quickviewProduct.attributes.properties, function(property){
                                    return property.attributeFQN.toLowerCase() == "tenant~color-mapping";
                                }),
                                cdn = hyprlivecontext.locals.siteContext.cdnPrefix +"/cms/files/";

                            if(imageMapping && imageMapping.values[0].value){
                                window.quickviewProduct.set("colorMaps", []);
                                var colors = _.find(window.quickviewProduct.attributes.options.models, function(option){
                                    return option.id.toLowerCase() == "tenant~color";
                                });
                                $(colors.attributes.values).each(function(){
                                    $.get(cdn + window.quickviewProduct.id +"_"+ this.value + "_1.jpg").then(function(){
                                        var numberOfImages = getNumberOfColoredImages(2, this.value, window.quickviewProduct);
                                    }.bind(this), function(){
                                        window.quickviewProduct.attributes.colorMaps.push({color: this.value, numOfImgsIndex: 0});
                                    }.bind(this));
                                });
                                window.quickviewProduct.attributes.colorMaps.push({color: "oldImgs", imgs: _.clone(window.quickviewProduct.attributes.content.attributes.productImages)});
                            }

                            // REMOVE PREVIOUS EVENTS (IF ANY)
                            $('.quickviewSlider').off('click', 'button.btnAddToCart');
                            $('.quickviewSlider').off('click', '.mz-wishlist');
                            $('.quickviewSlider').off('click', '.mz-qty-control');
                            $('.quickviewSlider').off('click', '.mz-productdetail-qty');
                            $('.quickviewSlider').off('click', '.continueshopping');
                            $('.quickviewSlider').off('click', '.color_swatch');
                            $('.quickviewSlider').off('click', '.mz-wishlist:not(".addedToWishList") #add-to-wishlist:not(".is-disabled"):not(":disabled")');

                            $(".quickviewElement").off('click');

                            // SHOW ERROR ON FIELDS NOT FILLED IN
                            // if($(".mz-productoptions-valuecontainer input:radio")){
                            //     var color = "#ff0000";
                            //     if($(".mz-productoptions-valuecontainer input:radio:checked").val()){
                            //         color = "#000";
                            //     }
                            //     $(".mz-productoptions-valuecontainer input:radio + label").each(function(){
                            //         $(this).css("border-color", color);
                            //     });
                            // }
                            // $(".mz-productdetail-options input, .mz-productdetail-options select").each(function(){
                            //     if(($(this).val() && $(this).val().toLowerCase() == "select") || !$(this).val()){
                            //         $(this).css("border-color", "red");
                            //     } else {
                            //         $(this).css("border-color", "black");
                            //     }
                            // });
                            // ADD LISTENER FOR ADD TO CART
                            $('.quickviewSlider').on('click', 'button.btnAddToCart', function() {
                                //var newQty = $('.mz-productdetail-qty').val();
                                var newQty = 1;
                                var body = $("html") || $("body");
                                //if($('.mz-productdetail-qty').val() > 0){
                                if(window.quickviewProduct.attributes.inventoryInfo.manageStock === true){
                                    if(typeof window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable === "undefined" || !window.quickviewProduct.attributes.purchasableState.isPurchasable ){
                                        blockUiLoader.productValidationMessage();
                                    }
                                    else{
                                        if (window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable >= newQty) {
                                            window.quickviewProduct.apiAddToCart({
                                                quantity: newQty
                                            }).then(function(){
                                                body.animate({ scrollTop: 0 }, "slow", function(){
                                                    CartMonitor.addToCount(newQty);
                                                });
                                                /*
                                                window.SoftCartInstance.update().then(function(){
                                                    window.SoftCartInstance.view.render();
                                                    window.SoftCartInstance.view.show();
                                                    CartMonitor.setCount(window.SoftCartInstance.view.model.count());
                                                });
                                                */
                                                $(".mz-validationmessage").text("");
                                                slider.closeQuickviewSlider();
                                            }, function(err){
                                                //$(".mz-validationmessage").text("We're sorry, we only have "+ window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable +" available. Those items have been added to your cart.");
                                                $('[data-mz-validationmessage-for="quantity"]').text("Please try again later.");
                                            });
                                        } else {
                                            window.quickviewProduct.apiAddToCart({
                                                quantity: window.quickviewProduct.attributes.inventoryInfo.onlineStockAvailable
                                            }).then(function(){
                                                body.animate({ scrollTop: 0 }, "slow", function(){
                                                    CartMonitor.addToCount(newQty);
                                                });
                                                $(".mz-validationmessage").text("");
                                                slider.closeQuickviewSlider();
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
                                    slider.closeQuickviewSlider();
                                }

                            });
                            $('#mz-close-button').click(function(e) {
                                e.preventDefault();
                                blockUiLoader.unblockUi();
                            });
                            // ADD LISTENER FOR CONTINUE SHOPPING
                            $(".quickviewSlider").on("click", ".continueshopping", function(){
                                slider.closeQuickviewSlider();
                            });

                            // ADD LISTENER FOR EXIT BUTTON
                            $(".quickviewSlider").on("click", ".close", function(){
                                slider.closeQuickviewSlider();
                            });

                            // ADD LISTENER FOR CLICK OUTSIDE OF QUICKVIEW
                            $(".quickviewElement").on("click", function(e){
                                if(e.target == this){
                                    slider.closeQuickviewSlider();
                                }
                            });

                            // ADD LISTENER FOR ADD TO WISHLIST
                            $('.quickviewSlider').on('click', '.mz-wishlist:not(".addedToWishList") #add-to-wishlist:not(".is-disabled"):not(":disabled")', function(e) {
                                blockUiLoader.globalLoader();
                                if(require.mozuData("user").isAnonymous){
                                    slider.closeQuickviewSlider();
                                    window.location.href = "/user/login?returnUrl="+window.location.pathname+encodeURIComponent(window.location.search);
                                } else {
                                    $(".quickviewElement").addClass("is-loading");
                                    try{
                                        window.quickviewProduct.addToWishlist();
                                    }catch(error){
                                        blockUiLoader.unblockUi();
                                        blockUiLoader.productValidationMessage();
                                    }

                                }
                            });
                        }); // END OF ADDING LISTENERS

                        $(modalDiv).on('hidden.bs.modal', function(e) {
                            window.quickviewProduct = null;
                        });

                        $(modalDiv).show().trigger("show");
                    } catch (err) {
                        //console.log('Error Obj:' + err);
                    }

                    // ADD INLINE WIDTH FOR IE
                    //$('.quickview-content.quickview-modal').attr('style', $('.quickview-content.quickview-modal').attr('style') + 'width: ' + $('.modal-body > [itemtype="http://schema.org/Product"]').width() + 'px');
                    //$('.modal-dialog[role="document"]').css('width', $('.modal-body > [itemtype="http://schema.org/Product"]').width() + 'px');
                }
                product.on('addedtowishlist', function (cartitem) {
                    updateWishlistUI(true);
                    blockUiLoader.unblockUi();
                });
                product.on('addedtowishlist-error', function (cartitem) {
                    blockUiLoader.unblockUi();
                    blockUiLoader.productValidationMessage();
                });


                product.on("change", function(model,options,data){
                    //console.log("product.variationProductCode:"+data.variationProductCode);
                    // Wishlist updated after getting values in model
                    $.ajax({
                        url:'/api/commerce/wishlists/'+wishlistId,
                        data:{
                            responseFields:'items'
                        },
                        headers: apiData.headers
                    }).then(function(data){
                        var items= data.items;
                        var isAlreadyAdded = false;
                        for (var j = 0; j < items.length; j++) {
                            if (items[j].product && items[j].product.productCode == product.attributes.productCode) {
                                if(items[j].product.variationProductCode){
                                    var wishlistProduct = items[j].product;
                                    if(wishlistProduct.variationProductCode == product.attributes.variationProductCode){
                                        updateWishlistUI(true);
                                        isAlreadyAdded = true;
                                        break;
                                    }
                                } else {
                                    updateWishlistUI(true);
                                }
                            }
                        }
                        if(!isAlreadyAdded){
                            updateWishlistUI(false);
                        }
                    });
                    // Set product price
                    if(window.quickviewProduct.attributes.price.attributes.price){
                        var priceModel = {onSale: product.attributes.price.onSale()},
                            priceTemplate = Hypr.getTemplate("modules/common/price");


                        _.extend(priceModel, product.attributes.price.attributes);

                        $(".quickviewElement .mz-pricestack").html(priceTemplate.render({
                            model: priceModel
                        }));
                    }
                    // if($(".mz-productoptions-valuecontainer input:radio")){
                    //     var color = "#ff0000";
                    //     if($(".mz-productoptions-valuecontainer input:radio:checked").val()){
                    //         color = "#000";
                    //     }
                    //     $(".mz-productoptions-valuecontainer input:radio + label").each(function(){
                    //         $(this).css("border-color", color);
                    //     });
                    // }
                    // $(".mz-productdetail-options input, .mz-productdetail-options select").each(function(){
                    //     if(($(this).data('value') && $(this).data('value').toLowerCase() == "select") || !$(this).data('value')){
                    //         $(this).css("border-color", "red");
                    //     } else {
                    //         $(this).css("border-color", "black");
                    //     }
                    // });

                });

                // Displays UPC and stock messages
                //showStockMessage();
            });
        }
    }); // END OF PRODUCT DETAILS QUICK VIEW

    $(document).ready(function(){
        var product = ProductModels.Product.fromCurrent();
        var quickViewView = new QuickViewView({
            el: $('body')
        });
    });
});