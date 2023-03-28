import { Outlet } from "react-router";

const MainLayout = () => <div style={{
    width: "800px", margin: "0 auto", height: "100%",
    border: "1px solid white", boxSizing: "border-box",
}}>
    <Outlet />
</div>;

export default MainLayout;
