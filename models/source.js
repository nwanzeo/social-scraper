var database = require('../lib/database');
var mongoose = database.mongoose;
var validate = require('mongoose-validator').validate;
var _ = require('underscore');
require('../lib/error');

var EVENTS_TO_RETURN = 50;

var sourceSchema = new mongoose.Schema({
  type: String,
  nickname: {type: String, required: true, validate: validate('max', 20)},
  resource_id: String,
  url: String,
  keywords: String,
  enabled: {type: Boolean, default: true},
  events: {type: Array, default: []},
  unreadErrorCount: {type: Number, default: 0},
  lastReportDate: Date
});

sourceSchema.pre('save', function(next) {
  // Do not allow changing type
  if (!this.isNew && this.isModified('type')) return next(new Error.Validation('source_type_change_not_allowed'));
  // Notify when changing error count
  if (!this.isNew && this.isModified('unreadErrorCount')) {
    sourceSchema.emit(this.unreadErrorCount ? 'sourceErrorCountUpdated' : 'sourceErrorCountCleared', _.pick(this.toJSON(), ['_id', 'unreadErrorCount']));
  }
  // Only allow a single Twitter source
  if (this.isNew && this.type === 'twitter') {
    Source.findOne({type: 'twitter'}, function(err, source) {
      if (source) return next(new Error.Validation('only_one_twitter_allowed'));
      else next();
    });
  } else next();
});

sourceSchema.post('save', function() {
  sourceSchema.emit('source:save', {_id: this._id.toString()});
});

sourceSchema.pre('remove', function(next) {
  sourceSchema.emit('source:remove', {_id: this._id.toString()});
  next();
});

// Enable source
sourceSchema.methods.enable = function() {
  if (!this.enabled) {
    this.enabled = true;
    this.save(function(err, source) {
      sourceSchema.emit('source:enable', {_id: source._id.toString()});
    });
  }
};

// Disable source
sourceSchema.methods.disable = function() {
  if (this.enabled) {
    this.enabled = false;
    this.save(function(err, source) {
      sourceSchema.emit('source:disable', {_id: source._id.toString()});
    });
  }
};

// Log events in source
sourceSchema.methods.logEvent = function(level, message, callback) {
  this.events.push({datetime: Date.now(), type: level, message: message});
  if (level == 'error') this.disable();
  this.unreadErrorCount++;
  this.save(callback);
};

var Source = mongoose.model('Source', sourceSchema);

// Get latest unread error messages
Source.findByIdWithLatestEvents = function(_id, callback) {
  Source.findById(_id, function(err, source) {
    if (err) return callback(err);
    if (!source) return callback(null, null);
    if (source.events) {
      source.events = _.chain(source.events).sortBy('datetime').last(EVENTS_TO_RETURN).value();
    }
    callback(null, source);
  });
};

// Reset unread error count back to zero
Source.resetUnreadErrorCount = function(_id, callback) {
  Source.findById(_id, '-events', function(err, source) {
    if (err) return callback(err);
    if (!source) return callback(null, null);
    source.unreadErrorCount = 0;
    source.save(callback);
  });
};

module.exports = Source;
