"use client";

import Image from "next/image";
import Link from "next/link";
import { assetPath, availableStock, isEmployeeRole, CatalogItem, money, productPresentation, retailStockLocation, partFamilyLabels, partPriceLabel } from "@/src/lib/storefront";
import { Brand } from "./brand";
import { Icon } from "./icon";
import { StoreDialogs } from "./store-dialogs";
import { StorefrontModel, useStorefront } from "./use-storefront";

export default function Storefront() {
  const shop = useStorefront();
  const { promotion, role, session, totals, notice, setNotice, setAccountOpen, openAuth, setCartOpen, categories, category, setCategory,
    selectedLocation, setSelectedLocation, locations, catalogError, catalogLoading, items, parts, visibleItems, visibleParts, hasSpecificParts, selectedPartFamily, setSelectedPartFamily, partFamilies } = shop;

  return <main className="storefront">
    <div className="store-announcement">{promotion
      ? <span>YOUR FIRST RIDE STARTS HERE <b>·</b> {Number(promotion.percent_off)}% off your first order with <strong>{promotion.code}</strong></span>
      : <span>YOUR NEXT RIDE STARTS HERE · SHOP ONLINE, PICK UP LOCAL</span>}</div>
    <header className="store-header">
      <Link href="/" className="brand-link" aria-label="Wasatch Cycle Works home"><Brand /></Link>
      <nav className="store-nav" aria-label="Main navigation"><a href="#bikes">Shop bikes</a><a href="#parts">Shop parts</a><a href="#pickup">Pickup</a><a href="#locations">Our stores</a></nav>
      <div className="store-header-actions">
        <Link href="/employee" className="employee-link">{isEmployeeRole(role) ? "Employee workspace" : "Employee sign in"}<Icon name="arrow" size={14}/></Link>
        <button className="icon-button account-button" onClick={() => session ? setAccountOpen(true) : openAuth()} aria-label={session ? "My account and orders" : "Customer sign in"}><Icon name="user"/></button>
        <button className="bag-button" onClick={() => setCartOpen(true)} aria-label={`Shopping bag, ${totals.units} items`}><Icon name="bag"/><span>Bag</span><b>{totals.units}</b></button>
      </div>
    </header>

    {notice && <div className="store-toast" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice("")}><Icon name="close" size={16}/></button></div>}

    <section className="store-hero store-hero-panorama">
      <div className="store-hero-copy"><p className="store-kicker"><span/> UTAH, IN MOTION</p><h1>A better day<br/>starts with<br/><em>a bike.</em></h1><p className="hero-description">From your morning commute to the road less traveled. Find your ride, choose your local store, and get out there.</p><a href="#bikes" className="store-button">Find your ride <Icon name="arrow"/></a><a href="#locations" className="hero-store-link"><Icon name="pin" size={17}/> Find your local pickup store</a></div>
      <div className="store-hero-image"><Image src={assetPath("hero-panorama.webp")} alt="A bicycle overlooking a panoramic view of the Wasatch Mountains" width={1913} height={822} priority unoptimized sizes="100vw"/><div className="hero-image-caption"><span>THE LONG WAY HOME</span><p>More trails. More possibilities.</p></div><span className="hero-image-tag">WASATCH CYCLE WORKS / UTAH</span></div>
    </section>

    <div className="store-benefits"><span><Icon name="pin"/>Local pickup, your way</span><span><Icon name="box"/>Store availability, live</span><span><Icon name="check"/>One account. Every adventure.</span></div>

    <section className="store-collection store-section" id="bikes">
      <div className="collection-heading"><div><p className="store-kicker">THE COLLECTION</p><h2>Find your kind of ride.</h2></div><p>A bike for the places you’re going.<br/>A little inspiration for the places you haven’t found.</p></div>
      <div className="collection-controls">
        <div className="category-tabs" aria-label="Filter bike collection">{categories.map((entry) => <button key={entry} className={category === entry ? "active" : ""} aria-pressed={category === entry} onClick={() => setCategory(entry)}>{entry}</button>)}</div>
        <label className="store-picker"><Icon name="pin" size={17}/><span className="sr-only">Pickup store</span><select value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)} disabled={!locations.length}>{locations.length ? locations.map((location) => <option key={location.id} value={location.id}>Pickup: {location.city}</option>) : <option>Loading stores…</option>}</select></label>
      </div>
      {catalogError ? <div className="store-empty"><h3>We couldn’t load store availability.</h3><p>Please refresh before adding a bike or checking out.</p><button className="store-button" onClick={() => void shop.refreshCatalog()}>Try again</button></div>
        : catalogLoading && !items.length ? <div className="product-loading" role="status">Loading bikes and live store availability…</div>
        : <div className="retail-product-grid">{visibleItems.map((item) => <ProductCard key={item.id} item={item} shop={shop}/>)}</div>}
      {!catalogLoading && !catalogError && !visibleItems.length && <div className="store-empty">No bikes are available in this collection yet.</div>}
      <p className="product-imagery-note">Product imagery is illustrative. Prices and availability reflect the selected store.</p>
    </section>

    <section className="store-parts store-section" id="parts">
      <div className="collection-heading"><div><p className="store-kicker">THE PARTS BEHIND THE RIDE</p><h2>Keep a good thing going.</h2></div><p>Shop the components used in our bike builds.<br/>Pick up at your local Wasatch store.</p></div>
      <div className="parts-collection-bar"><span>Frames, wheels, tires, and the details that bring it all together.</span><label className="store-picker"><Icon name="pin" size={17}/><span className="sr-only">Parts pickup store</span><select value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)}>{locations.map((location) => <option key={location.id} value={location.id}>Pickup: {location.city}</option>)}</select></label></div>
      <div className="parts-fit-controls"><p className="parts-fit-help">{hasSpecificParts ? "Choose a part, then select your bike model to see its exact price and availability." : "General replacement components. Check bike fit with the store before ordering."}</p><label className="store-field">Part category<select value={selectedPartFamily} onChange={(event) => setSelectedPartFamily(event.target.value)}><option value="">All parts</option>{partFamilies.map((family) => <option key={family} value={family}>{partFamilyLabels[family]}</option>)}</select></label></div>
      {catalogError ? <div className="store-empty"><p>Parts availability could not be loaded.</p><button className="store-button" onClick={() => void shop.refreshCatalog()}>Try again</button></div> : catalogLoading && !parts.length ? <p className="product-loading">Loading parts…</p> : !visibleParts.length ? <div className="store-empty">No parts in this category have been listed yet.</div> : <div className="retail-product-grid">{visibleParts.map((group) => <PartCard key={group.key} name={group.name} variants={group.variants} shop={shop}/>)}</div>}
      <p className="product-imagery-note">Product imagery is illustrative. Your bag records the exact bike-specific component selected. Check a bike’s details to see its bill of materials.</p>
    </section>

    <section className="pickup-section" id="pickup"><div className="pickup-intro"><p className="store-kicker">ONLINE TO OUTSIDE</p><h2>Your next adventure.<br/>A little closer.</h2><p>Shop from wherever you are. Pick up from the people and places close to home.</p></div><div className="pickup-steps"><article><Icon name="bag" size={28}/><h3>Find your bike</h3><p>Explore the collection and check availability at your preferred store.</p></article><article><Icon name="check" size={28}/><h3>Make it yours</h3><p>Sign in, review your bag, and continue to secure online payment.</p></article><article><Icon name="pin" size={28}/><h3>Pick up local</h3><p>Follow your order in your account, then collect it at your selected store.</p></article></div></section>

    <section className="store-locations store-section" id="locations"><div className="collection-heading"><div><p className="store-kicker">ROOTED IN UTAH</p><h2>See you at the shop.</h2></div><p>Choose your pickup location.<br/>Your local inventory is always connected.</p></div><div className="location-grid">{locations.map((location) => <article key={location.id} className={selectedLocation === location.id ? "selected-location" : ""}><Icon name="pin" size={24}/><h3>{location.city}</h3><p>{location.name} · {location.postal_code}</p><button onClick={() => { setSelectedLocation(location.id); document.getElementById("bikes")?.scrollIntoView({ behavior: "smooth" }); }}>{selectedLocation === location.id ? "Your pickup store" : "Shop this store"}<Icon name={selectedLocation === location.id ? "check" : "arrow"} size={17}/></button></article>)}</div></section>

    <footer className="store-footer"><div><Link href="/" className="brand-link" aria-label="Wasatch Cycle Works home"><Brand/></Link><p>Good bikes. Local roots.<br/>A little more open road.</p></div><nav aria-label="Footer navigation"><a href="#bikes">Shop bikes</a><a href="#parts">Shop parts</a><button onClick={() => session ? setAccountOpen(true) : openAuth()}>My account & orders</button><a href="#locations">Pickup locations</a><Link href="/employee">Employee sign in</Link></nav><div className="store-footer-note"><p>Wasatch Cycle Works is a fictional business built for an ERP course demo.</p><p>Built with OpenAI Codex · GitHub Pages · Supabase</p></div></footer>
    <StoreDialogs shop={shop}/>
  </main>;
}

function ProductCard({ item, shop }: { item: CatalogItem; shop: StorefrontModel }) {
  const view = productPresentation(item);
  const source = retailStockLocation(item, shop.store, shop.allLocations);
  const available = source ? availableStock(shop.stock, item.id, source) : 0;
  const forSale = Number(item.sale_price) > 0 && Boolean(source);
  return <article className="retail-product">
    <button className="retail-product-image" onClick={() => shop.openProduct(item)} aria-label={`View ${item.name}`}><span className="product-category">{view.category}</span><Image src={assetPath(view.image)} alt={`${item.name} illustrative product image`} width={1200} height={800} sizes="(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 33vw" unoptimized/><span className="product-view">View bike <Icon name="arrow" size={15}/></span></button>
    <div className="retail-product-info"><div className="product-name-price"><h3><button onClick={() => shop.openProduct(item)}>{item.name}</button></h3><strong>{Number(item.sale_price) > 0 ? money(item.sale_price) : "Not available yet"}</strong></div><p>{view.caption}</p><div className={`product-availability${available > 0 ? "" : " backorder"}`}><i/>{shop.availability(item)}</div><button className="product-add" disabled={!forSale} onClick={() => shop.addToCart(item)}>{forSale ? "Add to bag" : "Not available to order"}<span aria-hidden="true">+</span></button></div>
  </article>;
}

function PartCard({ name, variants, shop }: { name: string; variants: CatalogItem[]; shop: StorefrontModel }) {
  const part = variants[0];
  const view = productPresentation(part);
  const hasFits = variants.some((variant) => Boolean(variant.compatible_bike_id));
  return <article className="retail-product">
    <button className="retail-product-image" onClick={() => shop.openProduct(part)} aria-label={`View ${name}`}><span className="product-category">{view.category}</span><Image src={assetPath(view.image)} alt={`${name} illustrative product image`} width={1200} height={800} sizes="(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 33vw" unoptimized/><span className="product-view">Choose your fit <Icon name="arrow" size={15}/></span></button>
    <div className="retail-product-info"><div className="product-name-price"><h3><button onClick={() => shop.openProduct(part)}>{name}</button></h3><strong>{partPriceLabel(variants)}</strong></div><p>{view.caption}</p><div className="product-availability">{hasFits ? `${variants.length} bike fits · select your model` : "General part · confirm bike fit"}</div><button className="product-add" onClick={() => shop.openProduct(part)}>{hasFits ? "Choose bike & add" : "View part"}<span aria-hidden="true">+</span></button></div>
  </article>;
}
