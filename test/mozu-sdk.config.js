require(['sdk'], function(Mozu) {

    // assuming an AMD environment. The above is equivalent to:
    // var Mozu = require('mozu-javascript-sdk/dist/mozu-javascript-sdk');
    // in a CommonJS environment.

    var myStoreApiContext = Mozu.Store({
        "tenant": 2561,
        "master-catalog": 1,
        "site": 1234,
        "app-claims": "+RuyRpztqvRNrWTpbc...XNbC",
        "currency": "usd",
        "locale": "en-US"
    });

    // the above objects will probably come out of your store configuration on the server side and need to be serialized as JSON.


    // you need to set individual base URLs for the following services
    myStoreApiContext.setServiceUrls({
        "productService": "/api/commerce/catalog/storefront/products/",
        "categoryService": "/api/commerce/catalog/storefront/categories/",
        "cartService": "/api/commerce/carts/",
        "customerService": "https://yourstoredomain.com/api/commerce/customer/accounts/",
        "orderService": "https://yourstoredomain.com/api/commerce/orders/",
        "searchService": "/api/commerce/catalog/storefront/productsearch/",
        "referenceService": "/api/platform/reference/",
        "paymentService": "https://payments-sb.mozu.com/payments/Mozu/cards/",
        "addressValidationService": "/api/commerce/customer/addressvalidation/",
        "wishlistService": "/api/commerce/wishlists/",
        "returnService": "https://yourstoredomain.com/api/commerce/returns",
        "storefrontUserService": "https://yourstoredomain.com/user/",
        "locationService": "/api/commerce/storefront/",
        "creditService": "/api/commerce/customer/credits/"
    });

    // configuration complete, you may now retrieve an API interface
    var myStoreApi = myStoreApiContext.api();

    // and begin manipulating API objects!
    myStoreApi.get('product','MS-CYC-BIK-004').then(function(product) {
        console.log(product.prop('content').name); // -> "Diamondback Sortie 3 29er Bike - 2013"
    });
});