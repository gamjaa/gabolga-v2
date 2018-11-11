if (window.innerWidth < 360){
    var viewport = document.querySelector("meta[name=viewport]");
    viewport.parentNode.removeChild(viewport);

    var newViewport = document.createElement("meta");
    newViewport.setAttribute("name", "viewport");
    newViewport.setAttribute("content", "width=360");
    document.head.appendChild(newViewport);
}