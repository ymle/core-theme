require(['modules/jquery-mozu', 'hyprlive', 'modules/backbone-mozu', 'modules/models-location', 'modules/models-product',
    'hyprlivecontext', 'shim!vendor/bootstrap/js/modal[jquery=jQuery]'],
    function($, Hypr, Backbone, LocationModels, ProductModels,
        HyprLiveContext) {

          var ModalView = Backbone.MozuView.extend({
            templateName: 'modules/cart/modal-location-select',
            initialize: function(){ console.log("Initialized"); },
            render: function() {
              Backbone.MozuView.prototype.render.apply(this);
            }
          });


          $(document).ready(function(){


            var $element = $('#modal-contain');
            var locationsCollection = new LocationModels.LocationCollection();
            var product = ProductModels.Product.fromCurrent();
            locationsCollection.apiGetForProduct({
              productCode: product.get('variationProductCode') || product.get('productCode')
            }).then(function(){
              console.log("Got the thingie");

              var view = new ModalView({
                model: locationsCollection,
                el: $element
              });
              $element.modal();

                view.render();

            });


          });

        }
      );
