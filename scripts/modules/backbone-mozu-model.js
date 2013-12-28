﻿/**
 * Extends the BackboneJS Model object to create a Backbone.MozuModel with extra
 * features for model nesting, error handling, validation, and connection to the
 * JavaScript SDK.
 */
define([
    "modules/jquery-mozu",
    "shim!vendor/underscore>_",
    "modules/api",
    "shim!vendor/backbone[shim!vendor/underscore>_=_,jquery=jQuery]>Backbone",
    "modules/models-messages",
    "modules/backbone-mozu-validation"], function ($, _, api, Backbone, MessageModels) {

        var Model = Backbone.Model,
           Collection = Backbone.Collection;

        // Detects dot notation in named properties and deepens a flat object to respect those property names.
        // Pessimistically, prefers dot-notated properties over properly deep ones
        function deepen(obj) {
            var ret = {};
            _.each(obj, function (val, key) {
                var ctx = ret, level;
                key = key.split('.');
                while (key.length > 1) {
                    level = key.shift();
                    ctx = ctx[level] || (ctx[level] = {});
                }
                ctx[key[0]] = val;
            });
            return ret;
        }

        var methodMap = {
            'read': 'get',
            'delete': 'del'
        };

        Backbone.MozuModel = Backbone.Model.extend(_.extend({}, Backbone.Validation.mixin, {
            constructor: function (conf) {
                this.helpers = (this.helpers || []).concat(['isLoading', 'isValid']);
                Backbone.Model.apply(this, arguments);
                if (this.mozuType) this.initApiModel(conf);
                if (this.handlesMessages) {
                    this.initMessages();
                } else {
                    this.passErrors();
                }
            },
            passErrors: function() {
                var self = this;
                _.defer(function() {
                    var ctx = self;
                    while(ctx = ctx.parent) {
                        if (ctx.handlesMessages) {
                            self.on('error', function(e, c) {
                                ctx.trigger('error', e, c);
                            });
                            break;
                        }
                    }
                }, 300);
            },
            get: function (propName) {
                var prop = propName.split('.'), ret = this, level;
                while (ret && (level = prop.shift())) ret = Backbone.Model.prototype.get.call(ret, level);
                if (!ret && this.relations && (propName in this.relations)) {
                    ret = this.setRelation(propName, null, { silent: true });
                    this.attributes[propName] = ret;
                }
                return ret;
            },
            setRelation: function (attr, val, options) {
                var relation = this.attributes[attr],
                    id = this.idAttribute || "id",
                    modelToSet, modelsToAdd = [], modelsToRemove = [];

                //if (options.unset && relation) delete relation.parent;

                if (this.relations && _.has(this.relations, attr)) {

                    // If the relation already exists, we don't want to replace it, rather
                    // update the data within it whether it is a collection or model
                    if (relation && relation instanceof Collection) {

                        id = relation.model.prototype.idAttribute || id;

                        // If the val that is being set is already a collection, use the models
                        // within the collection.
                        if (val instanceof Collection || val instanceof Array) {
                            val = val.models || val;
                            modelsToAdd = _.clone(val);

                            relation.each(function (model, i) {

                                // If the model does not have an "id" skip logic to detect if it already
                                // exists and simply add it to the collection
                                if (typeof model.id == 'undefined') return;

                                // If the incoming model also exists within the existing collection,
                                // call set on that model. If it doesn't exist in the incoming array,
                                // then add it to a list that will be removed.
                                var rModel = _.find(val, function (_model) {
                                    return _model[id] === model.id;
                                });

                                if (rModel) {
                                    model.set(rModel.toJSON ? rModel.toJSON() : rModel);

                                    // Remove the model from the incoming list because all remaining models
                                    // will be added to the relation
                                    modelsToAdd.splice(i, 1);
                                } else {
                                    modelsToRemove.push(model);
                                }

                            });

                            _.each(modelsToRemove, function (model) {
                                relation.remove(model);
                            });

                            relation.add(modelsToAdd);

                        } else {

                            // The incoming val that is being set is not an array or collection, then it represents
                            // a single model.  Go through each of the models in the existing relation and remove
                            // all models that aren't the same as this one (by id). If it is the same, call set on that
                            // model.

                            relation.each(function (model) {
                                if (val && val[id] === model[id]) {
                                    model.set(val);
                                } else {
                                    relation.remove(model);
                                }
                            });
                        }

                        return relation;
                    }

                    if (relation && relation instanceof Model) {
                        if (options.useExistingInstances && val instanceof this.relations[attr]) return val;
                        if (options.unset) {
                            relation.clear();
                        } else {
                            relation.set((val && val.toJSON) ? val.toJSON() : val);
                        }
                        return relation;
                    }

                    options._parent = this;

                    if (!(val instanceof this.relations[attr])) val =  new this.relations[attr](val, options);
                    val.parent = this;
                }

                return val;
            },
            // Preprocess attributes to set data types before they're stored in the attrs hash.
            set: function (key, val, options) {
                var attr, attrs, unset, changes, silent, changing, prev, current;
                if (key == null) return this;

                // Handle both `"key", value` and `{key: value}` -style arguments.
                if (typeof key === 'object') {
                    attrs = key;
                    options = val;
                } else {
                    (attrs = {})[key] = val;
                }

                options || (options = {});

                // allow for dot notation in setting properties remotely on related models, by shifting context!
                attrs = deepen(attrs);

                // Run validation.
                if (!this._validate(attrs, options)) return false;

                // Extract attributes and options.
                unset = options.unset;
                silent = options.silent;
                changes = [];
                changing = this._changing;
                this._changing = true;

                if (!changing) {
                    this._previousAttributes = _.clone(this.attributes);
                    this.changed = {};
                }
                current = this.attributes, prev = this._previousAttributes;

                // Check for changes of `id`.
                if (this.idAttribute in attrs) this.id = attrs[this.idAttribute];

                // For each `set` attribute, update or delete the current value.
                for (attr in attrs) {
                    val = attrs[attr];

                    // Inject in the relational lookup
                    val = this.setRelation(attr, val, options);

                    if (this.dataTypes && attr in this.dataTypes) {
                        val = this.dataTypes[attr](val);
                    }

                    if (!_.isEqual(current[attr], val)) changes.push(attr);
                    if (!_.isEqual(prev[attr], val)) {
                        this.changed[attr] = val;
                    } else {
                        delete this.changed[attr];
                    }
                    var isARelation = this.relations && this.relations[attr] && (val instanceof this.relations[attr]);
                    (unset && !isARelation) ? delete current[attr] : current[attr] = val;
                }

                // Trigger all relevant attribute changes.
                if (!silent) {
                    if (changes.length) this._pending = true;
                    for (var i = 0, l = changes.length; i < l; i++) {
                        this.trigger('change:' + changes[i], this, current[changes[i]], options);
                    }
                }

                if (changing) return this;
                if (!silent) {
                    while (this._pending) {
                        this._pending = false;
                        this.trigger('change', this, options, attrs);
                    }
                }
                this._pending = false;
                this._changing = false;
                return this;
            },
            initApiModel: function (conf) {
                var me = this;
                this.apiModel = api.createSync(this.mozuType, conf);
                if (!this.apiModel || !this.apiModel.on) return;
                this.apiModel.on('action', function () {
                    me.isLoading(true);
                    me.trigger('request');
                });
                this.apiModel.on('sync', function (rawJSON) {
                    me.isLoading(false);
                    if (rawJSON) me.set(rawJSON);
                    me.trigger('sync', rawJSON);
                });
                this.apiModel.on('spawn', function (rawJSON) {
                    me.isLoading(false);
                });
                this.apiModel.on('error', function (err) {
                    me.isLoading(false);
                    me.trigger('error', err);
                });
                this.on('change', function () {
                    me.apiModel.prop(me.changedAttributes());
                });
            },
            syncApiModel: function() {
                this.apiModel.prop(this.toJSON());
            },
            initMessages: function () {
                var me = this;
                me.messages = new MessageModels.MessagesCollection();
                me.hasMessages = function () {
                    return me.messages.length > 0;
                };
                me.helpers.push('hasMessages');
                me.on('error', function (err) {
                    if (err.items && err.items.length) {
                        me.messages.reset(err.Items);
                    } else {
                        me.messages.reset([err]);
                    }
                });
                me.on('sync', function (raw) {
                    if (!raw || !raw.messages || raw.messages.length === 0) me.messages.reset();
                });
                _.each(this.relations, function (v, key) {
                    var relInstance = me.get(key);
                    if (relInstance) me.listenTo(relInstance, 'error', function (err) {
                        me.trigger('error', err);
                    });
                });
            },
            fetch: function() {
                var self = this;
                return this.apiModel.get().then(function() {
                    return self;
                });
            },
            sync: function (method, model, options) {
                method = methodMap[method] || method;
                model.apiModel[method](model.attributes).then(function (model) {
                    options.success(model.data);
                }, function (error) {
                    options.error(error);
                });
            },
            isLoading: function (yes, opts) {
                if (arguments.length == 0) return !!this._isLoading;
                this._isLoading = yes;
                if (!opts || !opts.silent) this.trigger('loadingchange', yes);
            },
            getHelpers: function () {
                return this.helpers;
            },
            toJSON: function (options) {
                var attrs = _.clone(this.attributes);
                if (options && options.helpers) {
                    _.each(this.getHelpers(), function (helper) {
                        attrs[helper] = this[helper]();
                    }, this);
                    if (this.hasMessages) attrs.messages = this.messages.toJSON();
                    if (this.validation) attrs.isValid = this.isValid(options.forceValidation);
                }

                _.each(this.relations, function (rel, key) {
                    if (_.has(attrs, key)) {
                        attrs[key] = attrs[key].toJSON(options);
                    }
                });

                return (options && options.ensureCopy) ? JSON.parse(JSON.stringify(attrs)) : attrs;
            }
        }), {
            fromCurrent: function () {
                return new this(require.mozuData(this.prototype.mozuType), { silent: true });
            },
            DataTypes: {
                "Int": function (val) {
                    val = parseInt(val);
                    return isNaN(val) ? 0 : val;
                },
                "Float": function (val) {
                    val = parseFloat(val);
                    return isNaN(val) ? 0 : val;
                },
                "Boolean": function (val) {
                    return typeof val === "string" ? val.toLowerCase() === "true" : !!val;
                }
            }
        });

        function flattenValidation(proto, into, prefix) {
            _.each(proto.validation, function (val, key) {
                into[prefix + key] = val;
            });
            if (!proto.__validationFlattened) {
                _.each(proto.relations, function (val, key) {
                    flattenValidation(val.prototype, into, key + '.');
                });
            }
            proto.__validationFlattened = true;
            return into;
        }

        Backbone.MozuModel.extend = function (conf, statics) {
            if (conf) conf.validation = flattenValidation(conf, {}, '');
            if (conf && conf.mozuType) {
                // reflect all methods
                var actions = api.getAvailableActionsFor(conf.mozuType);
                if (actions) _.each(actions, function (actionName) {
                    var apiActionName = "api" + actionName.charAt(0).toUpperCase() + actionName.substring(1);
                    if (!(apiActionName in conf)) {
                        conf[apiActionName] = function (data) {
                            var self = this;
                            // include self by default...
                            if (actionName in { 'create': true, 'update': true }) data = data || this.toJSON();
                            if (typeof data === "object" && !$.isArray(data) && !$.isPlainObject(data)) data = null;
                            this.syncApiModel();
                            this.isLoading(true);
                            var p = this.apiModel[actionName](data);
                            p.ensure(function () {
                                self.isLoading(false);
                            });
                            return p;
                        };
                    }
                });

            }
            return Backbone.Model.extend.call(this, conf, statics);
        };

        Backbone.Collection.prototype.resetRelations = function (options) {
            _.each(this.models, function (model) {
                _.each(model.relations, function (rel, key) {
                    if (model.get(key) instanceof Backbone.Collection) {
                        model.get(key).trigger('reset', model, options);
                    }
                });
            })
        };

        Backbone.Collection.prototype.reset = function (models, options) {
            options || (options = {});
            for (var i = 0, l = this.models.length; i < l; i++) {
                this._removeReference(this.models[i]);
            }
            options.previousModels = this.models;
            this._reset();
            this.add(models, _.extend({ silent: true }, options));
            if (!options.silent) {
                this.trigger('reset', this, options);
                this.resetRelations(options);
            }
            return this;
        };
        return Backbone;
});
