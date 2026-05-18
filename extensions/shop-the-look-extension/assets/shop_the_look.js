// add to cart logic
document.addEventListener("DOMContentLoaded", function () {
  var addToCartButtons = document.querySelectorAll(".submit-cardlook button");
  addToCartButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      var productContainer = button.closest(".m-product-item");
      var selectedVariant = productContainer.querySelector(".shopLook");
      console.log(selectedVariant.value);
      this.innerHTML = '<span class="merox-loader-sp"></span>';
      addToCart(selectedVariant.value, this);
    });
  });
  async function addToCart(variantId, button) {
    try {
      const response = await fetch("/cart/add.js", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: variantId,
          quantity: 1,
        }),
      });
      if (!response.ok) {
        throw new Error(
          `Failed to add item to cart. Status: ${response.status}`
        );
      } else {
        button.textContent = "Added";
        setTimeout(() => {
          button.textContent = "Add To Cart";
        }, 3000);
      }
      const data = await response.json();
    } catch (error) {
      console.error("Error:", error.message);
    }
  }
});

// slider code logic
document.addEventListener("DOMContentLoaded", function () {
  const desktopProductListContainer = document.querySelector(".items");
  const mobileProductListContainer = document.querySelector(".drawer-product");
  let isDown = false;
  let startX;
  let scrollLeft;

  desktopProductListContainer.addEventListener("mousedown", (e) => {
    isDown = true;
    desktopProductListContainer.classList.add("active");
    startX = e.pageX - desktopProductListContainer.offsetLeft;
    scrollLeft = desktopProductListContainer.scrollLeft;
  });

  desktopProductListContainer.addEventListener("mouseleave", () => {
    isDown = false;
    desktopProductListContainer.classList.remove("active");
  });

  desktopProductListContainer.addEventListener("mouseup", () => {
    isDown = false;
    desktopProductListContainer.classList.remove("active");
  });

  desktopProductListContainer.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - desktopProductListContainer.offsetLeft;
    const walk = (x - startX) * 2;
    desktopProductListContainer.scrollLeft = scrollLeft - walk;
  });

  desktopProductListContainer.addEventListener("touchstart", (e) => {
    isDown = true;
    desktopProductListContainer.classList.add("active");
    startX = e.touches[0].pageX - desktopProductListContainer.offsetLeft;
    scrollLeft = desktopProductListContainer.scrollLeft;
  });

  desktopProductListContainer.addEventListener("touchend", () => {
    isDown = false;
    desktopProductListContainer.classList.remove("active");
  });

  desktopProductListContainer.addEventListener("touchcancel", () => {
    isDown = false;
    desktopProductListContainer.classList.remove("active");
  });

  desktopProductListContainer.addEventListener("touchmove", (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.touches[0].pageX - desktopProductListContainer.offsetLeft;
    const walk = (x - startX) * 2;
    desktopProductListContainer.scrollLeft = scrollLeft - walk;
  });

  const hotspots = document.querySelectorAll(".m_shoppable-image__hotspot");
  function triggerFirstHotspotAnimation() {
    var firstHotspot = document.querySelector(
      ".m_shoppable-image__hotspot:first-child"
    );
    if (firstHotspot) {
      // Check if the device is desktop
      if (window.innerWidth > 768) {
        firstHotspot.style.animation = "scaleEmoji 1s infinite linear";
      } else {
        // For mobile, trigger the corresponding action (replace this with your logic)
        var element = firstHotspot.getAttribute("data-product");
      }
    }
  }

  // Trigger the animation on the first hotspot when the page loads
  triggerFirstHotspotAnimation();

  hotspots.forEach(function (hotspot) {
    hotspot.addEventListener("click", function () {
      var element = hotspot.getAttribute("data-product");
      console.log(element);
      var selectedIndex = Array.from(
        document.querySelectorAll(".product-grid-items")
      ).findIndex(function (item) {
        return item.getAttribute("data-handle") === element;
      });

      desktopProductListContainer.scrollLeft =
        selectedIndex * desktopProductListContainer.offsetWidth;
      mobileProductListContainer.scrollLeft =
        selectedIndex * mobileProductListContainer.offsetWidth;

      // Remove animation from all hotspots
      hotspots.forEach(function (h) {
        h.style.animation = "none";
      });

      // Add animation directly using JavaScript to the currently clicked hotspot
      hotspot.style.animation = "scaleEmoji 1s infinite linear";
    });
  });
});

// drawer logic in mobile view
document.addEventListener("DOMContentLoaded", function () {
  var hotspots = document.querySelectorAll(".m_shoppable-image__hotspot");
  hotspots.forEach(function (hotspot) {
    hotspot.addEventListener("click", function () {
      var element = hotspot.getAttribute("data-product");
      console.log(element);

      if (window.innerWidth <= 768) {
        closeDrawer();
        openDrawer(element);
      }
    });
  });

  // Function to open drawer with corresponding product
  function openDrawer(productHandle) {
    var drawer = document.querySelector(".mobile-drawer");
    drawer.style.bottom = "0";
    // Add event listener to close drawer when clicking outside m_shopLook and left-container
    document.addEventListener("click", closeDrawerOnClickOutside);
  }

  // Function to close the drawer
  function closeDrawer() {
    var drawer = document.querySelector(".mobile-drawer");
    drawer.style.bottom = "-100%";
    // Remove the event listener when closing the drawer
    document.removeEventListener("click", closeDrawerOnClickOutside);
  }

  // Function to close drawer when clicking outside m_shopLook and left-container
  function closeDrawerOnClickOutside(event) {
    var drawer = document.querySelector(".mobile-drawer");
    var mShopLook = document.querySelector(".m_shopLook");
    var leftContainer = document.querySelector(".left-container");

    // Check if the click target is outside m_shopLook and left-container, but inside the drawer
    if (
      !mShopLook.contains(event.target) &&
      !leftContainer.contains(event.target) &&
      !drawer.contains(event.target)
    ) {
      closeDrawer();
    }
  }

  // Optional: Add close button functionality if needed
  var closeButton = document.querySelector(".mobile-drawer-close");
  if (closeButton) {
    closeButton.addEventListener("click", function () {
      closeDrawer();
    });
  }
});

function mobileDrawerHtml() {
  const itemsElement = document.querySelector(".items");
  const targetElement = document.querySelector(".m-drawer-content");

  if (!itemsElement || !targetElement) return;

  targetElement.innerHTML = itemsElement.innerHTML;
}
mobileDrawerHtml();
document.addEventListener("DOMContentLoaded", (event) => {
  const mobileSection = document.querySelector(".m_section");
  if (mobileSection) {
    const mobileHeadingText = mobileSection.getAttribute("data-mobile-heading");
    const mobileHeading = document.querySelector("#mobile-heading");

    if (mobileHeading && mobileHeadingText) {
      mobileHeading.textContent = mobileHeadingText;
    }
  }
});
