import { Navigate } from 'react-router-dom';

export function DesktopSearchRedirect() {
  //Desktop search is now List View in Memory page, so redirect there in case someone manually navigates here
  return <Navigate to="/memory" />;
}
