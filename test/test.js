describe("Checkout Test Suite", function() {
  var a;

  it("Checkout Instance Setup", function() {
    window.location.href = "https://t17238-s26790.sandbox.mozu.com"
    

    expect(a).toBe("Checkout - Mystic Demo - Master");
  });

  it("Not", function() {
    a = true;

    expect(a).toBe(true);
  });
});


describe("A suite is just a function 2", function() {
  var a;

  it("and so is a spec", function() {
    a = true;

    expect(a).toBe(true);
  });
});