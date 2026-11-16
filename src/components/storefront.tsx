"use client";

import Image from "next/image";
import Link from "next/link";
import { assetPath, availableStock, isEmployeeRole, money, productPresentation } from "@/src/lib/storefront";
import { Brand } from "./brand";
import { Icon } from "./icon";
import { StoreDialogs } from "./store-dialogs";
import { useStorefront } from "./use-storefront";

export default function Storefront() {
  const shop = useStorefront();
  const { promotion, role, session, totals, notice, setNotice, setAccountOpen, openAuth, setCartOpen, categories, category, setCategory,
    selectedLocation, setSelectedLocation, locations, catalogError, catalogLoading, items, visibleItems, stock, setDetail, addToCart, availability } = shop;

  return <main className="storefront">
    <div className="store-announcement">{promotion
      ? <span>YOUR FIRST RIDE STARTS HERE <b>·</b> {Number(promotion.percent_off)}% off your first order with <strong>{promotion.code}</strong></span>
      : <span>YOUR NEXT RIDE STARTS HERE · SHOP ONLINE, PICK UP LOCAL</span>}</div>
    <header className="store-header">
      <Link href="/" className="brand-link" aria-label="Wasatch Cycle Works home"><Brand /></Link>
      <nav className="store-nav" aria-label="Main navigation"><a href="#bikes">Shop bikes</a><a href="#pickup">How pickup works</a><a href="#locations">Our stores</a></nav>
      <div className="store-header-actions">
        <Link href="/employee" className="employee-link">{isEmployeeRole(role) ? "Employee workspace" : "Employee sign in"}<Icon name="arrow" size={14}/></Link>
        <button className="icon-button account-button" onClick={() => session ? setAccountOpen(true) : openAuth()} aria-label={session ? "My account and orders" : "Customer sign in"}><Icon name="user"/></button>
        <button className="bag-button" onClick={() => setCartOpen(true)} aria-label={`Shopping bag, ${totals.units} items`}><Icon name="bag"/><span>Bag</span><b>{totals.units}</b></button>
      </div>
    </header>

    {notice && <div className="store-toast" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice("")}><Icon name="close" size={16}/></button></div>}

    <section className="store-hero">
      <div className="store-hero-copy"><p className="store-kicker"><span/> UTAH, IN MOTION</p><h1>A better day<br/>starts with<br/><em>a bike.</em></h1><p className="hero-description">From your morning commute to the road less traveled. Find your ride, choose your local store, and get out there.</p><a href="#bikes" className="store-button">Find your ride <Icon name="arrow"/></a><a href="#locations" className="hero-store-link"><Icon name="pin" size={17}/> Find your local pickup store</a></div>
      <div className="store-hero-image"><Image src={assetPath("hero.webp")} alt="A bicycle beside a mountain trail in the Utah foothills" width={1536} height={1024} priority unoptimized sizes="(max-width: 800px) 100vw, 58vw"/><div className="hero-image-caption"><span>THE LONG WAY HOME</span><p>More trails. More possibilities.</p></div><span className="hero-image-tag">WASATCH CYCLE WORKS / UTAH</span></div>
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
        : <div className="retail-product-grid">{visibleItems.map((item) => {
          const view = productPresentation(item);
          const available = availableStock(stock, item.id, selectedLocation);
          return <article className="retail-product" key={item.id}>
            <button className="retail-product-image" onClick={() => setDetail(item)} aria-label={`View ${item.name}`}><span className="product-category">{view.category}</span><Image src={assetPath(view.image)} alt={`${item.name} illustrative product image`} width={1200} height={800} sizes="(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 33vw" unoptimized/><span className="product-view">View bike <Icon name="arrow" size={15}/></span></button>
            <div className="retail-product-info"><div className="product-name-price"><h3><button onClick={() => setDetail(item)}>{item.name}</button></h3><strong>{money(item.sale_price)}</strong></div><p>{view.caption}</p><div className={`product-availability${available > 0 ? "" : " backorder"}`}><i/>{availability(item)}</div><button className="product-add" onClick={() => addToCart(item)}>Add to bag <span aria-hidden="true">+</span></button></div>
          </article>;
        })}</div>}
      {!catalogLoading && !catalogError && !visibleItems.length && <div className="store-empty">No bikes are available in this collection yet.</div>}
      <p className="product-imagery-note">Product imagery is illustrative. Prices and availability reflect the selected store.</p>
    </section>

    <section className="pickup-section" id="pickup"><div className="pickup-intro"><p className="store-kicker">ONLINE TO OUTSIDE</p><h2>Your next adventure.<br/>A little closer.</h2><p>Shop from wherever you are. Pick up from the people and places close to home.</p></div><div className="pickup-steps"><article><Icon name="bag" size={28}/><h3>Find your bike</h3><p>Explore the collection and check availability at your preferred store.</p></article><article><Icon name="check" size={28}/><h3>Make it yours</h3><p>Sign in, review your bag, and continue to secure online payment.</p></article><article><Icon name="pin" size={28}/><h3>Pick up local</h3><p>Follow your order in your account, then collect it at your selected store.</p></article></div></section>

    <section className="store-locations store-section" id="locations"><div className="collection-heading"><div><p className="store-kicker">ROOTED IN UTAH</p><h2>See you at the shop.</h2></div><p>Choose your pickup location.<br/>Your local inventory is always connected.</p></div><div className="location-grid">{locations.map((location) => <article key={location.id} className={selectedLocation === location.id ? "selected-location" : ""}><Icon name="pin" size={24}/><h3>{location.city}</h3><p>{location.name} · {location.postal_code}</p><button onClick={() => { setSelectedLocation(location.id); document.getElementById("bikes")?.scrollIntoView({ behavior: "smooth" }); }}>{selectedLocation === location.id ? "Your pickup store" : "Shop this store"}<Icon name={selectedLocation === location.id ? "check" : "arrow"} size={17}/></button></article>)}</div></section>

    <footer className="store-footer"><div><Link href="/" className="brand-link" aria-label="Wasatch Cycle Works home"><Brand/></Link><p>Good bikes. Local roots.<br/>A little more open road.</p></div><nav aria-label="Footer navigation"><a href="#bikes">Shop the collection</a><button onClick={() => session ? setAccountOpen(true) : openAuth()}>My account & orders</button><a href="#locations">Pickup locations</a><Link href="/employee">Employee sign in</Link></nav><div className="store-footer-note"><p>Wasatch Cycle Works is a fictional business built for an ERP course demo.</p><p>Built with OpenAI Codex · GitHub Pages · Supabase</p></div></footer>
    <StoreDialogs shop={shop}/>
  </main>;
}
