// Just receive 'foo' message and forward it back
// as 'bar' message
addMessageListener("foo", function (message) {
  sendAsyncMessage("bar", message);
});

addMessageListener("assert", function (message) {
  assert.ok(true, "valid assertion");
  assert.ok(false, "invalid assertion");
  assert.equal(1, 2, "invalid equal assertion");
});
